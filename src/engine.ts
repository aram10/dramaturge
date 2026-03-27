import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WebProbeConfig } from "./config.js";
import type { FrontierItem, WorkerResult, BudgetConfig, MissionConfig } from "./types.js";
import { authenticate } from "./auth/authenticator.js";
import { captureFingerprint } from "./graph/fingerprint.js";
import { classifyPage } from "./planner/page-classifier.js";
import { StateGraph } from "./graph/state-graph.js";
import { FrontierQueue } from "./graph/frontier.js";
import { Planner } from "./planner/planner.js";
import { Navigator } from "./planner/navigator.js";
import { CoverageTracker } from "./coverage/tracker.js";
import { BrowserErrorCollector } from "./browser-errors.js";
import { saveCheckpoint, loadCheckpoint, hydrateFromCheckpoint } from "./checkpoint.js";
import { hasLLMApiKey } from "./llm.js";
import { MAX_NAV_RETRIES } from "./constants.js";
import type { EngineContext } from "./engine/context.js";
import { initWorkerPool, closeWorkerPool, createStagehand } from "./engine/worker-pool.js";
import { collectResults, expandGraph, routeFollowups, maintainFrontier, flushBrowserErrors } from "./engine/graph-ops.js";
import { buildAreaResults, writeReports } from "./engine/reports.js";
import { executeFrontierItem } from "./engine/execute-frontier-item.js";
import type { WorkerSession } from "./engine/worker-pool.js";

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

function handleNavFailure(
  ctx: EngineContext,
  item: FrontierItem,
  logPrefix = ""
): void {
  console.log(`${logPrefix}  Navigation failed`);
  item.retryCount++;
  if (item.retryCount >= MAX_NAV_RETRIES) {
    ctx.globalCoverage.addBlindSpot({
      nodeId: item.nodeId,
      summary: `Unreachable: ${item.objective}`,
      reason: "state-unreachable",
      severity: "medium",
    });
  } else {
    ctx.frontier.requeue(item);
  }
}

interface BatchTaskResult {
  item: FrontierItem;
  result: WorkerResult | null;
  pageKey: string;
}

/** Run frontier items in parallel across the worker pool. */
async function processTaskBatch(
  ctx: EngineContext,
  batchItems: FrontierItem[],
  taskNumberStart: number
): Promise<BatchTaskResult[]> {
  const primaryWorker: WorkerSession = {
    key: "primary",
    stagehand: ctx.stagehand,
    page: ctx.page,
  };
  const workers = [primaryWorker, ...ctx.workerPool];

  const promises = batchItems.map(async (item, i): Promise<BatchTaskResult> => {
    const worker = workers[i % workers.length];
    const taskNumber = taskNumberStart + i;
    const result = await executeFrontierItem({
      ctx,
      stagehand: worker.stagehand,
      page: worker.page,
      item,
      taskNumber,
      pageKey: worker.key,
    });

    if (!result.result) {
      handleNavFailure(
        ctx,
        item,
        workers.length > 1 ? `  [${taskNumber}]` : ""
      );
    }

    return {
      ...result,
      pageKey: worker.key,
    };
  });

  return Promise.all(promises);
}

export interface RunEngineOptions {
  resumeDir?: string;
}

export async function runEngine(
  config: WebProbeConfig,
  options: RunEngineOptions = {}
): Promise<void> {
  const startTime = new Date();
  const timestamp = startTime
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outputDir = options.resumeDir ?? resolve(join(config.output.dir, timestamp));
  const screenshotDir = join(outputDir, "screenshots");
  mkdirSync(screenshotDir, { recursive: true });

  console.log(`WebProbe v2 starting — target: ${config.targetUrl}`);
  console.log(`Output: ${outputDir}`);

  const budget = resolveBudget(config);
  const mission = buildMission(config);
  const concurrency = config.concurrency.workers;
  const useLLMPlanner = hasLLMApiKey();

  // Browser error auto-capture
  const errorCollector = new BrowserErrorCollector({
    captureConsole: config.autoCapture.consoleErrors,
    captureNetwork: config.autoCapture.networkErrors,
    networkErrorMinStatus: config.autoCapture.networkErrorMinStatus,
  });

  // Initialize primary Stagehand
  const stagehand = createStagehand(config);
  await stagehand.init();
  errorCollector.attach(stagehand.context.pages()[0], "primary");

  // Initialize worker pool for parallel execution
  const workerPool = concurrency > 1
    ? await initWorkerPool(config, concurrency - 1, errorCollector)
    : [];

  if (concurrency > 1) {
    console.log(`Worker pool: ${concurrency} parallel browsers`);
  }

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
    outputDir,
    findingsByNode: new Map(),
    evidenceByNode: new Map(),
    errorCollector,
    completedTaskIds: new Set(),
    workerPool,
  };

  try {
    // Authenticate primary browser
    console.log(`\nAuthenticating (strategy: ${config.auth.type})...`);
    await authenticate(stagehand, config);
    console.log("Authentication successful.");

    // Check for resume
    let tasksExecuted = 0;
    if (options.resumeDir) {
      const checkpoint = loadCheckpoint(options.resumeDir);
      if (checkpoint) {
        const hydrated = hydrateFromCheckpoint(
          checkpoint,
          ctx.graph,
          ctx.frontier,
          ctx.globalCoverage
        );
        ctx.findingsByNode = hydrated.findingsByNode;
        ctx.evidenceByNode = hydrated.evidenceByNode;
        ctx.completedTaskIds = hydrated.completedTaskIds;
        tasksExecuted = hydrated.tasksExecuted;
        console.log(
          `Resumed from checkpoint: ${tasksExecuted} tasks, ${ctx.graph.nodeCount()} states, ${ctx.frontier.size()} pending`
        );
      }
    }

    // Seed graph if starting fresh (no resume or empty graph)
    if (ctx.graph.nodeCount() === 0) {
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

      // Seed initial tasks — use LLM planner if available
      let seedTasks: FrontierItem[];
      if (useLLMPlanner) {
        seedTasks = await ctx.planner.proposeTasksWithLLM(
          rootNode,
          ctx.graph,
          config.models.planner,
          mission
        );
      } else {
        seedTasks = ctx.planner.proposeTasks(rootNode, ctx.graph, mission);
      }
      ctx.frontier.enqueueMany(seedTasks);
      console.log(`Seeded frontier with ${seedTasks.length} tasks\n`);
    }

    // === Main planner loop ===
    const startMs = Date.now();
    const checkpointInterval = config.checkpoint.intervalTasks;
    let tasksSinceCheckpoint = 0;

    while (ctx.frontier.hasItems()) {
      const elapsedMs = Date.now() - startMs;
      if (elapsedMs > budget.globalTimeLimitSeconds * 1000) {
        console.log("Time budget exhausted.");
        break;
      }

      // Dequeue a batch of items (up to concurrency)
      const batchItems: FrontierItem[] = [];
      for (let i = 0; i < concurrency && ctx.frontier.hasItems(); i++) {
        const item = ctx.frontier.dequeueHighest();
        if (!item) break;
        // Skip already-completed tasks (from resume)
        if (ctx.completedTaskIds.has(item.id)) {
          item.status = "completed";
          i--; // don't count this toward batch size
          continue;
        }
        batchItems.push(item);
      }

      if (batchItems.length === 0) break;

      const batchResults = await processTaskBatch(
        ctx,
        batchItems,
        tasksExecuted + 1
      );

      // Collect results and expand graph
      for (const { item, result, pageKey } of batchResults) {
        flushBrowserErrors(ctx, item.nodeId, pageKey);
        if (!result) continue;

        collectResults(ctx, item.nodeId, result);

        const coverageInfo =
          result.coverageSnapshot.controlsExercised > 0
            ? `, coverage: ${result.coverageSnapshot.controlsExercised}/${result.coverageSnapshot.controlsDiscovered}`
            : "";
        console.log(
          `  ${result.outcome}: ${result.findings.length} findings${coverageInfo}`
        );

        await expandGraph(ctx, item.nodeId, result, useLLMPlanner);
        routeFollowups(ctx, item.nodeId, result);

        item.status = "completed";
        ctx.completedTaskIds.add(item.id);
        tasksExecuted++;
        tasksSinceCheckpoint++;
      }

      maintainFrontier(ctx);

      // Periodic checkpoint
      if (
        checkpointInterval > 0 &&
        tasksSinceCheckpoint >= checkpointInterval
      ) {
        saveCheckpoint(
          outputDir,
          ctx.graph,
          ctx.frontier,
          ctx.findingsByNode,
          ctx.evidenceByNode,
          ctx.globalCoverage,
          [...ctx.completedTaskIds],
          tasksExecuted
        );
        tasksSinceCheckpoint = 0;
        console.log(`  Checkpoint saved (${tasksExecuted} tasks completed)`);
      }

      // Navigate primary browser back to root
      try {
        await ctx.page.goto(config.targetUrl);
      } catch {
        console.warn("  Failed to navigate back to root URL.");
      }
    }

    // Flush any remaining browser errors
    if (ctx.graph.nodeCount() > 0) {
      const rootNode = ctx.graph.getAllNodes().find((n) => n.depth === 0);
      if (rootNode) {
        flushBrowserErrors(ctx, rootNode.id, "primary");
        for (const worker of ctx.workerPool) {
          flushBrowserErrors(ctx, rootNode.id, worker.key);
        }
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

    // Final checkpoint
    if (checkpointInterval > 0) {
      saveCheckpoint(
        outputDir,
        ctx.graph,
        ctx.frontier,
        ctx.findingsByNode,
        ctx.evidenceByNode,
        ctx.globalCoverage,
        [...ctx.completedTaskIds],
        tasksExecuted
      );
    }

    // Generate reports with per-node attribution
    const areaResults = buildAreaResults(ctx);
    writeReports(ctx, startTime, areaResults, remaining);

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
    throw error;
  } finally {
    errorCollector.detach();
    await closeWorkerPool(workerPool);
    await stagehand.context.close();
  }
}
