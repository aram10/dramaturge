import { Stagehand } from "@browserbasehq/stagehand";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WebProbeConfig } from "./config.js";
import { resolveWorkerModel } from "./config.js";
import type {
  AreaResult,
  Evidence,
  FrontierItem,
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

// ---------------------------------------------------------------------------
// Types for internal engine state passed between decomposed functions
// ---------------------------------------------------------------------------

interface EngineContext {
  config: WebProbeConfig;
  budget: BudgetConfig;
  mission: MissionConfig | undefined;
  stagehand: Stagehand;
  page: ReturnType<Stagehand["context"]["pages"]>[number];
  graph: StateGraph;
  frontier: FrontierQueue;
  planner: Planner;
  navigator: Navigator;
  globalCoverage: CoverageTracker;
  screenshotDir: string;
  /** Findings keyed by the node ID that produced them. */
  findingsByNode: Map<string, RawFinding[]>;
  /** Evidence keyed by the node ID that produced it. */
  evidenceByNode: Map<string, Evidence[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveBudget(config: WebProbeConfig): BudgetConfig {
  return {
    globalTimeLimitSeconds:
      config.budget.globalTimeLimitSeconds ??
      config.exploration.totalTimeout,
    maxStepsPerTask:
      config.budget.maxStepsPerTask ?? config.exploration.stepsPerArea,
    maxFrontierSize: config.budget.maxFrontierSize ?? 200,
    maxStateNodes: config.budget.maxStateNodes ?? 50,
  };
}

function buildMission(config: WebProbeConfig): MissionConfig | undefined {
  if (!config.mission) return undefined;
  return {
    ...config.mission,
    appDescription: config.appDescription,
    destructiveActionsAllowed:
      config.mission.destructiveActionsAllowed ?? false,
  };
}

// ---------------------------------------------------------------------------
// Task processing
// ---------------------------------------------------------------------------

async function processTask(
  ctx: EngineContext,
  item: FrontierItem,
  taskNumber: number
): Promise<WorkerResult | null> {
  const node = ctx.graph.getNode(item.nodeId);
  console.log(
    `[${taskNumber}] ${item.workerType} task on ${node.pageType} (${node.url ?? node.id}): ${item.objective}`
  );

  // Navigate to target state
  const navResult = await ctx.navigator.navigateTo(
    item.nodeId,
    ctx.graph,
    ctx.page,
    ctx.stagehand,
    ctx.config.targetUrl
  );

  if (!navResult.success) {
    console.log(`  Navigation failed: ${navResult.reason}`);
    item.retryCount++;
    if (item.retryCount >= 2) {
      ctx.globalCoverage.addBlindSpot({
        nodeId: item.nodeId,
        summary: `Unreachable: ${item.objective}`,
        reason: "state-unreachable",
        severity: "medium",
      });
    } else {
      ctx.frontier.requeue(item);
    }
    return null;
  }

  // Execute the worker
  ctx.planner.recordDispatch(item.nodeId, item.workerType);
  ctx.graph.recordVisit(item.nodeId);

  const model = resolveWorkerModel(ctx.config, item.workerType);
  return executeWorkerTask(
    ctx.stagehand,
    {
      id: item.id,
      workerType: item.workerType,
      nodeId: item.nodeId,
      objective: item.objective,
      maxSteps: ctx.budget.maxStepsPerTask,
      pageType: node.pageType,
      missionContext: ctx.config.appDescription,
    },
    model,
    ctx.screenshotDir
  );
}

// ---------------------------------------------------------------------------
// Result collection + per-node attribution
// ---------------------------------------------------------------------------

function collectResults(
  ctx: EngineContext,
  nodeId: string,
  result: WorkerResult
): void {
  // Attribute findings and evidence to the node
  const nodeFindings = ctx.findingsByNode.get(nodeId) ?? [];
  nodeFindings.push(...result.findings);
  ctx.findingsByNode.set(nodeId, nodeFindings);

  const nodeEvidence = ctx.evidenceByNode.get(nodeId) ?? [];
  nodeEvidence.push(...result.evidence);
  ctx.evidenceByNode.set(nodeId, nodeEvidence);

  // Merge coverage events into global tracker + node
  for (const event of result.coverageSnapshot.events) {
    ctx.globalCoverage.recordEvent(event);
    ctx.graph.addDiscoveredControl(nodeId, event.controlId);
    if (event.outcome === "worked") {
      ctx.graph.addExercisedControl(nodeId, event.controlId);
    }
  }
}

// ---------------------------------------------------------------------------
// Graph expansion from discovered edges
// ---------------------------------------------------------------------------

async function expandGraph(
  ctx: EngineContext,
  sourceNodeId: string,
  result: WorkerResult
): Promise<void> {
  if (ctx.graph.nodeCount() >= ctx.budget.maxStateNodes) return;

  const sourceNode = ctx.graph.getNode(sourceNodeId);

  for (const edge of result.discoveredEdges) {
    if (ctx.graph.nodeCount() >= ctx.budget.maxStateNodes) break;

    // Workers report edges with placeholder fingerprints — resolve them
    let fingerprint = edge.targetFingerprint;
    let pageType = edge.targetPageType;

    if (fingerprint.hash === "") {
      // Navigate to the discovered URL to capture real fingerprint
      const resolved = await resolveEdgeFingerprint(ctx, edge.navigationHint);
      if (!resolved) continue;
      fingerprint = resolved.fingerprint;
      pageType = resolved.pageType;

      // Navigate back to root so subsequent processing stays consistent
      try {
        await ctx.page.goto(ctx.config.targetUrl);
      } catch {
        // best-effort
      }
    }

    const existing = ctx.graph.findByFingerprint(fingerprint);
    if (!existing) {
      const newNode = ctx.graph.addNode({
        fingerprint,
        pageType,
        url: edge.navigationHint.url,
        depth: sourceNode.depth + 1,
        navigationHint: edge.navigationHint,
      });
      graph_addEdge(ctx, sourceNodeId, newNode.id, edge);

      const newTasks = ctx.planner.proposeTasks(
        newNode,
        ctx.graph,
        ctx.mission
      );
      ctx.frontier.enqueueMany(newTasks);
      console.log(
        `  Discovered new state: ${newNode.pageType} (${newNode.id}), +${newTasks.length} tasks`
      );
    }
  }
}

async function resolveEdgeFingerprint(
  ctx: EngineContext,
  hint: { url?: string; selector?: string; actionDescription?: string }
): Promise<{ fingerprint: Awaited<ReturnType<typeof captureFingerprint>>; pageType: Awaited<ReturnType<typeof classifyPage>> } | null> {
  try {
    if (hint.url) {
      await ctx.page.goto(hint.url);
    } else if (hint.selector) {
      await ctx.stagehand.act(
        `Click the element matching "${hint.selector}"`
      );
      await new Promise((r) => setTimeout(r, 500));
    } else if (hint.actionDescription) {
      await ctx.stagehand.act(hint.actionDescription);
      await new Promise((r) => setTimeout(r, 500));
    } else {
      return null; // no way to navigate
    }

    const fingerprint = await captureFingerprint(ctx.page);
    const pageType = await classifyPage(ctx.page);
    return { fingerprint, pageType };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Could not resolve discovered edge: ${msg}`);
    return null;
  }
}

function graph_addEdge(
  ctx: EngineContext,
  fromId: string,
  toId: string,
  edge: WorkerResult["discoveredEdges"][number]
): void {
  ctx.graph.addEdge(fromId, toId, edge);
}

// ---------------------------------------------------------------------------
// Follow-ups + frontier maintenance
// ---------------------------------------------------------------------------

function routeFollowups(
  ctx: EngineContext,
  sourceNodeId: string,
  result: WorkerResult
): void {
  for (const followup of result.followupRequests) {
    const followupItem = ctx.planner.routeFollowup(followup, sourceNodeId);
    ctx.frontier.enqueue(followupItem);
  }
}

function maintainFrontier(ctx: EngineContext): void {
  if (ctx.frontier.size() > ctx.budget.maxFrontierSize) {
    const pruned = ctx.frontier.pruneLowest(0.25);
    for (const p of pruned) {
      ctx.globalCoverage.addBlindSpot({
        nodeId: p.nodeId,
        summary: `Pruned: ${p.objective}`,
        reason: "pruned",
        severity: "low",
      });
    }
    console.log(`  Pruned ${pruned.length} low-priority frontier items`);
  }
}

// ---------------------------------------------------------------------------
// Report generation — per-node attribution instead of flat "All Areas"
// ---------------------------------------------------------------------------

function buildAreaResults(ctx: EngineContext): AreaResult[] {
  const results: AreaResult[] = [];

  for (const node of ctx.graph.getAllNodes()) {
    const findings = ctx.findingsByNode.get(node.id) ?? [];
    const evidence = ctx.evidenceByNode.get(node.id) ?? [];
    if (findings.length === 0 && evidence.length === 0 && node.timesVisited === 0) {
      continue; // skip nodes that were never visited and have no data
    }

    results.push({
      name: node.title ?? `${node.pageType} (${node.id})`,
      url: node.url,
      steps: node.timesVisited,
      findings,
      screenshots: new Map<string, Buffer>(),
      evidence,
      coverage: {
        controlsDiscovered: node.controlsDiscovered.length,
        controlsExercised: node.controlsExercised.length,
        events: [], // per-node events not tracked separately — use global
      },
      pageType: node.pageType,
      fingerprint: node.fingerprint,
      status: node.timesVisited > 0 ? "explored" : "skipped",
    });
  }

  return results;
}

function writeReports(
  config: WebProbeConfig,
  startTime: Date,
  outputDir: string,
  areaResults: AreaResult[],
  remaining: FrontierItem[]
): void {
  const runResult = buildRunResult(
    config.targetUrl,
    startTime,
    areaResults,
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
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

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

  const budget = resolveBudget(config);
  const mission = buildMission(config);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: config.models.planner,
    localBrowserLaunchOptions: { headless: false },
    verbose: 0,
  });
  await stagehand.init();

  const ctx: EngineContext = {
    config,
    budget,
    mission,
    stagehand,
    page: stagehand.context.pages()[0],
    graph: new StateGraph(),
    frontier: new FrontierQueue(),
    planner: new Planner(),
    navigator: new Navigator(),
    globalCoverage: new CoverageTracker(),
    screenshotDir,
    findingsByNode: new Map(),
    evidenceByNode: new Map(),
  };

  try {
    // Authenticate
    console.log(`\nAuthenticating (strategy: ${config.auth.type})...`);
    await authenticate(stagehand, config);
    console.log("Authentication successful.");

    // Navigate to root and seed the graph
    await ctx.page.goto(config.targetUrl);
    const rootFingerprint = await captureFingerprint(ctx.page);
    const rootPageType = await classifyPage(ctx.page);
    const rootNode = ctx.graph.addNode({
      url: config.targetUrl,
      title: rootFingerprint.title,
      fingerprint: rootFingerprint,
      pageType: rootPageType,
      depth: 0,
    });
    console.log(
      `Root state: ${rootPageType} (fingerprint: ${rootFingerprint.hash})`
    );

    // Seed initial tasks
    const seedTasks = ctx.planner.proposeTasks(rootNode, ctx.graph, mission);
    ctx.frontier.enqueueMany(seedTasks);
    console.log(`Seeded frontier with ${seedTasks.length} tasks\n`);

    // === Main planner loop ===
    const startMs = Date.now();
    let tasksExecuted = 0;

    while (ctx.frontier.hasItems()) {
      const elapsedMs = Date.now() - startMs;
      if (elapsedMs > budget.globalTimeLimitSeconds * 1000) {
        console.log("Time budget exhausted.");
        break;
      }

      const item = ctx.frontier.dequeueHighest();
      if (!item) break;

      const result = await processTask(ctx, item, tasksExecuted + 1);
      if (!result) continue; // navigation failed — already handled

      collectResults(ctx, item.nodeId, result);

      const coverageInfo =
        result.coverageSnapshot.controlsExercised > 0
          ? `, coverage: ${result.coverageSnapshot.controlsExercised}/${result.coverageSnapshot.controlsDiscovered}`
          : "";
      console.log(
        `  ${result.outcome}: ${result.findings.length} findings${coverageInfo}`
      );

      await expandGraph(ctx, item.nodeId, result);
      routeFollowups(ctx, item.nodeId, result);
      maintainFrontier(ctx);

      item.status = "completed";
      tasksExecuted++;

      // Navigate back to root for next iteration
      try {
        await ctx.page.goto(config.targetUrl);
      } catch {
        console.warn("  Failed to navigate back to root URL.");
      }
    }

    // Record remaining frontier as blind spots
    const remaining = ctx.frontier.drain();
    for (const r of remaining) {
      ctx.globalCoverage.addBlindSpot({
        nodeId: r.nodeId,
        summary: `Not reached: ${r.objective}`,
        reason: "time-budget",
        severity: r.priority > 0.7 ? "high" : "low",
      });
    }

    // Generate reports with per-node attribution
    const areaResults = buildAreaResults(ctx);
    writeReports(config, startTime, outputDir, areaResults, remaining);

    // Summary
    const blindSpots = ctx.globalCoverage.getBlindSpots();
    const totalFindings = [...ctx.findingsByNode.values()].reduce(
      (sum, f) => sum + f.length,
      0
    );
    console.log(
      `\nDone. ${tasksExecuted} tasks executed, ${totalFindings} finding(s), ${ctx.graph.nodeCount()} states discovered, ${blindSpots.length} blind spot(s).`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFatal error: ${message}`);
    process.exit(1);
  } finally {
    await stagehand.context.close();
  }
}
