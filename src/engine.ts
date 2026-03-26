import { Stagehand } from "@browserbasehq/stagehand";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WebProbeConfig } from "./config.js";
import { resolveWorkerModel, resolveAgentMode } from "./config.js";
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
import { BrowserErrorCollector } from "./browser-errors.js";
import { saveCheckpoint, loadCheckpoint, hydrateFromCheckpoint } from "./checkpoint.js";
import { hasLLMApiKey } from "./llm.js";

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
  outputDir: string;
  /** Findings keyed by the node ID that produced them. */
  findingsByNode: Map<string, RawFinding[]>;
  /** Evidence keyed by the node ID that produced it. */
  evidenceByNode: Map<string, Evidence[]>;
  /** Browser error auto-capture collector. */
  errorCollector: BrowserErrorCollector;
  /** IDs of tasks already completed (used with --resume). */
  completedTaskIds: Set<string>;
  /** Extra Stagehand instances for parallel workers. */
  workerPool: Stagehand[];
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
// Task processing (sequential mode — concurrency=1)
// ---------------------------------------------------------------------------

async function processTasksSequentially(
  ctx: EngineContext,
  items: FrontierItem[],
  taskNumberStart: number
): Promise<Array<{ item: FrontierItem; result: WorkerResult | null }>> {
  const results: Array<{ item: FrontierItem; result: WorkerResult | null }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const taskNumber = taskNumberStart + i;
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
      results.push({ item, result: null });
      continue;
    }

    ctx.planner.recordDispatch(item.nodeId, item.workerType);
    ctx.graph.recordVisit(item.nodeId);

    const model = resolveWorkerModel(ctx.config, item.workerType);
    const result = await executeWorkerTask(
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
      ctx.screenshotDir,
      resolveAgentMode(ctx.config, item.workerType),
      ctx.config.output.screenshots,
      ctx.config.budget.stagnationThreshold ?? 0,
      ctx.config.appContext
    );

    results.push({ item, result });
  }

  return results;
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
  result: WorkerResult,
  useLLMPlanner = false
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
      ctx.graph.addEdge(sourceNodeId, newNode.id, edge);

      let newTasks: FrontierItem[];
      if (useLLMPlanner) {
        newTasks = await ctx.planner.proposeTasksWithLLM(
          newNode,
          ctx.graph,
          ctx.config.models.planner,
          ctx.mission
        );
      } else {
        newTasks = ctx.planner.proposeTasks(newNode, ctx.graph, ctx.mission);
      }
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
  ctx: EngineContext,
  startTime: Date,
  areaResults: AreaResult[],
  remaining: FrontierItem[]
): void {
  const config = ctx.config;
  const blindSpots = ctx.globalCoverage.getBlindSpots();
  const stateGraphMermaid = ctx.graph.nodeCount() > 0 ? ctx.graph.toMermaid() : undefined;
  const useLLMPlanner = !!process.env.ANTHROPIC_API_KEY;

  const runResult = buildRunResult(
    config.targetUrl,
    startTime,
    areaResults,
    remaining.map((r) => ({
      name: r.objective,
      reason: `Not reached (priority: ${r.priority.toFixed(2)})`,
    })),
    remaining.length > 0,
    blindSpots,
    stateGraphMermaid,
    {
      appDescription: config.appDescription,
      models: { planner: config.models.planner, worker: config.models.worker },
      concurrency: config.concurrency.workers,
      budget: {
        timeLimitSeconds: ctx.budget.globalTimeLimitSeconds,
        maxStepsPerTask: ctx.budget.maxStepsPerTask,
        maxStateNodes: ctx.budget.maxStateNodes,
      },
      checkpointInterval: config.checkpoint.intervalTasks,
      autoCaptureEnabled: config.autoCapture.consoleErrors || config.autoCapture.networkErrors,
      llmPlannerEnabled: useLLMPlanner,
    }
  );

  const format = config.output.format;
  if (format === "markdown" || format === "both") {
    const md = renderMarkdown(runResult);
    writeFileSync(join(ctx.outputDir, "report.md"), md, "utf-8");
    console.log(`\nMarkdown report: ${join(ctx.outputDir, "report.md")}`);
  }
  if (format === "json" || format === "both") {
    const json = renderJson(runResult);
    writeFileSync(join(ctx.outputDir, "report.json"), json, "utf-8");
    console.log(`JSON report: ${join(ctx.outputDir, "report.json")}`);
  }
}

// ---------------------------------------------------------------------------
// Parallel worker execution helper
// ---------------------------------------------------------------------------

async function initWorkerPool(
  config: WebProbeConfig,
  count: number,
  errorCollector: BrowserErrorCollector
): Promise<Stagehand[]> {
  if (count <= 0) return [];
  const pool: Stagehand[] = [];
  for (let i = 0; i < count; i++) {
    const sh = new Stagehand({
      env: "LOCAL",
      model: config.models.planner,
      localBrowserLaunchOptions: { headless: false },
      verbose: 0,
    });
    await sh.init();
    // Authenticate each worker browser
    await authenticate(sh, config);
    // Attach error collector to worker pages
    errorCollector.attach(sh.context.pages()[0]);
    pool.push(sh);
  }
  return pool;
}

async function closeWorkerPool(pool: Stagehand[]): Promise<void> {
  for (const sh of pool) {
    try {
      await sh.context.close();
    } catch {
      // best-effort
    }
  }
}

/**
 * Process a batch of frontier items in parallel using the worker pool.
 * Returns results paired with their frontier items.
 */
async function processTaskBatch(
  ctx: EngineContext,
  batchItems: FrontierItem[],
  taskNumberStart: number
): Promise<Array<{ item: FrontierItem; result: WorkerResult | null }>> {
  // Primary stagehand handles the first item, pool handles the rest
  const allWorkers = [ctx.stagehand, ...ctx.workerPool];

  const promises = batchItems.map(async (item, i) => {
    const worker = allWorkers[i % allWorkers.length];
    const page = worker.context.pages()[0];
    const node = ctx.graph.getNode(item.nodeId);
    const taskNum = taskNumberStart + i;

    console.log(
      `[${taskNum}] ${item.workerType} task on ${node.pageType} (${node.url ?? node.id}): ${item.objective}`
    );

    // Navigate to target state
    const navResult = await ctx.navigator.navigateTo(
      item.nodeId,
      ctx.graph,
      page,
      worker,
      ctx.config.targetUrl
    );

    if (!navResult.success) {
      console.log(`  [${taskNum}] Navigation failed: ${navResult.reason}`);
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
      return { item, result: null };
    }

    ctx.planner.recordDispatch(item.nodeId, item.workerType);
    ctx.graph.recordVisit(item.nodeId);

    const model = resolveWorkerModel(ctx.config, item.workerType);
    const result = await executeWorkerTask(
      worker,
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

    return { item, result };
  });

  return Promise.all(promises);
}

// ---------------------------------------------------------------------------
// Browser error flush helper
// ---------------------------------------------------------------------------

function flushBrowserErrors(ctx: EngineContext, nodeId: string): void {
  if (ctx.errorCollector.pendingCount === 0) return;

  const { findings, evidence } = ctx.errorCollector.flush();
  if (findings.length === 0) return;

  const nodeFindings = ctx.findingsByNode.get(nodeId) ?? [];
  nodeFindings.push(...findings);
  ctx.findingsByNode.set(nodeId, nodeFindings);

  const nodeEvidence = ctx.evidenceByNode.get(nodeId) ?? [];
  nodeEvidence.push(...evidence);
  ctx.evidenceByNode.set(nodeId, nodeEvidence);

  console.log(`  Auto-captured ${findings.length} browser error(s)`);
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

export interface RunEngineOptions {
  /** Directory of a previous run to resume from. */
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
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: config.models.planner,
    localBrowserLaunchOptions: { headless: false },
    verbose: 0,
  });
  await stagehand.init();
  errorCollector.attach(stagehand.context.pages()[0]);

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

      // Process batch (parallel if concurrency > 1, sequential if 1)
      const batchResults = concurrency > 1
        ? await processTaskBatch(ctx, batchItems, tasksExecuted + 1)
        : await processTasksSequentially(ctx, batchItems, tasksExecuted + 1);

      // Collect results and expand graph
      for (const { item, result } of batchResults) {
        if (!result) continue;

        collectResults(ctx, item.nodeId, result);
        flushBrowserErrors(ctx, item.nodeId);

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
      if (rootNode) flushBrowserErrors(ctx, rootNode.id);
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
