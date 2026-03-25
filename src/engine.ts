import { Stagehand } from "@browserbasehq/stagehand";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WebProbeConfig } from "./config.js";
import { resolveWorkerModel } from "./config.js";
import type {
  BlindSpot,
  Evidence,
  RawFinding,
  WorkerResult,
  BudgetConfig,
  MissionConfig,
} from "./types.js";
import { authenticate } from "./auth/authenticator.js";
import { captureFingerprint } from "./graph/fingerprint.js";
import { classifyPage } from "./planner/page-classifier.js";
import { StateGraph } from "./graph/state-graph.js";
import { FrontierQueue } from "./graph/frontier.js";
import { Planner } from "./planner/planner.js";
import { Navigator } from "./planner/navigator.js";
import { CoverageTracker } from "./coverage/tracker.js";
import { executeWorkerTask } from "./worker/worker.js";
import { buildRunResult } from "./report/collector.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderJson } from "./report/json.js";

export async function runEngine(config: WebProbeConfig): Promise<void> {
  const startTime = new Date();
  const timestamp = startTime
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outputDir = resolve(join(config.output.dir, timestamp));
  const screenshotDir = join(outputDir, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  console.log(`WebProbe v2 starting — target: ${config.targetUrl}`);
  console.log(`Output: ${outputDir}`);

  // Resolve budget with backward compat from exploration fields
  const budget: BudgetConfig = {
    globalTimeLimitSeconds:
      config.budget.globalTimeLimitSeconds ??
      config.exploration.totalTimeout,
    maxStepsPerTask:
      config.budget.maxStepsPerTask ?? config.exploration.stepsPerArea,
    maxFrontierSize: config.budget.maxFrontierSize ?? 200,
    maxStateNodes: config.budget.maxStateNodes ?? 50,
  };

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: config.models.planner,
    localBrowserLaunchOptions: { headless: false },
    verbose: 0,
  });
  await stagehand.init();

  const page = stagehand.context.pages()[0];
  const graph = new StateGraph();
  const frontier = new FrontierQueue();
  const planner = new Planner();
  const navigator = new Navigator();
  const globalCoverage = new CoverageTracker();
  const allFindings: RawFinding[] = [];
  const allEvidence: Evidence[] = [];

  try {
    // Authenticate
    console.log(`\nAuthenticating (strategy: ${config.auth.type})...`);
    await authenticate(stagehand, config);
    console.log("Authentication successful.");

    // Navigate to root and seed the graph
    await page.goto(config.targetUrl);
    const rootFingerprint = await captureFingerprint(page);
    const rootPageType = await classifyPage(page);
    const rootNode = graph.addNode({
      url: config.targetUrl,
      title: rootFingerprint.title,
      fingerprint: rootFingerprint,
      pageType: rootPageType,
      depth: 0,
    });
    console.log(
      `Root state: ${rootPageType} (fingerprint: ${rootFingerprint.hash})`
    );

    // Build mission context
    const mission: MissionConfig | undefined = config.mission
      ? {
          ...config.mission,
          appDescription: config.appDescription,
          destructiveActionsAllowed:
            config.mission.destructiveActionsAllowed ?? false,
        }
      : undefined;

    // Propose initial tasks
    const seedTasks = planner.proposeTasks(rootNode, graph, mission);
    frontier.enqueueMany(seedTasks);
    console.log(`Seeded frontier with ${seedTasks.length} tasks\n`);

    // === Main planner loop ===
    const startMs = Date.now();
    let tasksExecuted = 0;

    while (frontier.hasItems()) {
      // Budget: time check
      const elapsedMs = Date.now() - startMs;
      if (elapsedMs > budget.globalTimeLimitSeconds * 1000) {
        console.log("Time budget exhausted.");
        break;
      }

      const item = frontier.dequeueHighest();
      if (!item) break;

      const node = graph.getNode(item.nodeId);
      console.log(
        `[${tasksExecuted + 1}] ${item.workerType} task on ${node.pageType} (${node.url ?? node.id}): ${item.objective}`
      );

      // Navigate to target state
      const navResult = await navigator.navigateTo(
        item.nodeId,
        graph,
        page,
        stagehand,
        config.targetUrl
      );

      if (!navResult.success) {
        console.log(`  Navigation failed: ${navResult.reason}`);
        item.retryCount++;
        if (item.retryCount >= 2) {
          globalCoverage.addBlindSpot({
            nodeId: item.nodeId,
            summary: `Unreachable: ${item.objective}`,
            reason: "state-unreachable",
            severity: "medium",
          });
        } else {
          frontier.requeue(item);
        }
        continue;
      }

      // Execute the worker
      planner.recordDispatch(item.nodeId, item.workerType);
      node.timesVisited++;

      const model = resolveWorkerModel(config, item.workerType);
      const result: WorkerResult = await executeWorkerTask(
        stagehand,
        {
          id: item.id,
          workerType: item.workerType,
          nodeId: item.nodeId,
          objective: item.objective,
          maxSteps: budget.maxStepsPerTask,
          pageType: node.pageType,
          missionContext: config.appDescription,
        },
        model,
        screenshotDir
      );

      // Collect results
      allFindings.push(...result.findings);
      allEvidence.push(...result.evidence);

      // Merge coverage events
      for (const event of result.coverageSnapshot.events) {
        globalCoverage.recordEvent(event);
      }

      // Update node coverage data
      for (const event of result.coverageSnapshot.events) {
        if (!node.controlsDiscovered.includes(event.controlId)) {
          node.controlsDiscovered.push(event.controlId);
        }
        if (
          event.outcome === "worked" &&
          !node.controlsExercised.includes(event.controlId)
        ) {
          node.controlsExercised.push(event.controlId);
        }
      }

      const coverageInfo =
        result.coverageSnapshot.controlsExercised > 0
          ? `, coverage: ${result.coverageSnapshot.controlsExercised}/${result.coverageSnapshot.controlsDiscovered}`
          : "";
      console.log(
        `  ${result.outcome}: ${result.findings.length} findings${coverageInfo}`
      );

      // Expand graph with discovered edges
      if (graph.nodeCount() < budget.maxStateNodes) {
        for (const edge of result.discoveredEdges) {
          if (edge.targetFingerprint.hash === "") continue; // placeholder
          const existing = graph.findByFingerprint(edge.targetFingerprint);
          if (!existing) {
            const newNode = graph.addNode({
              fingerprint: edge.targetFingerprint,
              pageType: edge.targetPageType,
              depth: node.depth + 1,
              navigationHint: edge.navigationHint,
            });
            graph.addEdge(item.nodeId, newNode.id, edge);

            const newTasks = planner.proposeTasks(newNode, graph, mission);
            frontier.enqueueMany(newTasks);
            console.log(
              `  Discovered new state: ${newNode.pageType} (${newNode.id}), +${newTasks.length} tasks`
            );
          }
        }
      }

      // Route follow-up requests
      for (const followup of result.followupRequests) {
        const followupItem = planner.routeFollowup(followup, item.nodeId);
        frontier.enqueue(followupItem);
      }

      // Prune frontier if it's too large
      if (frontier.size() > budget.maxFrontierSize) {
        const pruned = frontier.pruneLowest(0.25);
        for (const p of pruned) {
          globalCoverage.addBlindSpot({
            nodeId: p.nodeId,
            summary: `Pruned: ${p.objective}`,
            reason: "pruned",
            severity: "low",
          });
        }
        console.log(
          `  Pruned ${pruned.length} low-priority frontier items`
        );
      }

      item.status = "completed";
      tasksExecuted++;

      // Navigate back to root for next iteration
      try {
        await page.goto(config.targetUrl);
      } catch {
        console.warn("  Failed to navigate back to root URL.");
      }
    }

    // Record remaining frontier as blind spots
    const remaining = frontier.drain();
    for (const r of remaining) {
      globalCoverage.addBlindSpot({
        nodeId: r.nodeId,
        summary: `Not reached: ${r.objective}`,
        reason: "time-budget",
        severity: r.priority > 0.7 ? "high" : "low",
      });
    }

    // === Generate reports ===
    const runResult = buildRunResult(
      config.targetUrl,
      startTime,
      [
        {
          name: "All Areas",
          url: config.targetUrl,
          steps: tasksExecuted,
          findings: allFindings,
          screenshots: new Map<string, Buffer>(),
          evidence: allEvidence,
          coverage: globalCoverage.snapshot(),
          pageType: "dashboard" as const,
          status: "explored" as const,
        },
      ],
      remaining.map((r) => ({
        name: r.objective,
        reason: `Not reached (priority: ${r.priority.toFixed(2)})`,
      })),
      remaining.length > 0
    );

    const format = config.output.format;
    if (format === "markdown" || format === "both") {
      const md = renderMarkdown(runResult);
      writeFileSync(join(outputDir, "report.md"), md, "utf-8");
      console.log(`\nMarkdown report: ${join(outputDir, "report.md")}`);
    }
    if (format === "json" || format === "both") {
      const json = renderJson(runResult);
      writeFileSync(join(outputDir, "report.json"), json, "utf-8");
      console.log(`JSON report: ${join(outputDir, "report.json")}`);
    }

    // Summary
    const blindSpots = globalCoverage.getBlindSpots();
    console.log(
      `\nDone. ${tasksExecuted} tasks executed, ${allFindings.length} finding(s), ${graph.nodeCount()} states discovered, ${blindSpots.length} blind spot(s).`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFatal error: ${message}`);
    process.exit(1);
  } finally {
    await stagehand.context.close();
  }
}
