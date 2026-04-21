// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { request as playwrightRequest } from 'playwright';
import type { LoadedDramaturgeConfig, DramaturgeConfig } from './config.js';
import { resolveResumeDir } from './config-paths.js';
import type {
  FrontierItem,
  WorkerResult,
  BudgetConfig,
  MissionConfig,
  WorkerType,
  StateNode,
} from './types.js';
import { authenticate } from './auth/authenticator.js';
import { captureStorageState } from './auth/storage-state.js';
import { captureFingerprint } from './graph/fingerprint.js';
import { classifyPage } from './planner/page-classifier.js';
import { StateGraph } from './graph/state-graph.js';
import { FrontierQueue } from './graph/frontier.js';
import { Planner } from './planner/planner.js';
import { Navigator } from './planner/navigator.js';
import { CoverageTracker } from './coverage/tracker.js';
import { CostTracker } from './coverage/cost-tracker.js';
import { BrowserErrorCollector } from './browser-errors.js';
import { saveCheckpoint, loadCheckpoint, hydrateFromCheckpoint } from './checkpoint.js';
import { hasLLMApiKey } from './llm.js';
import { MAX_NAV_RETRIES } from './constants.js';
import type { EngineContext } from './engine/context.js';
import { initWorkerPool, closeWorkerPool, createStagehand } from './engine/worker-pool.js';
import {
  collectResults,
  expandGraph,
  routeFollowups,
  maintainFrontier,
  assignPageNodeOwner,
  flushOwnedBrowserErrors,
} from './engine/graph-ops.js';
import { buildAreaResults, writeReports } from './engine/reports.js';
import { executeFrontierItem } from './engine/execute-frontier-item.js';
import type { WorkerSession } from './engine/worker-pool.js';
import { scanRepository } from './adaptation/repo-scan.js';
import type { RepoHints } from './adaptation/types.js';
import { buildDiffContext } from './diff/diff-hints.js';
import type { DiffContext } from './diff/types.js';
import { resolvePolicy } from './policy/policy.js';
import { MemoryStore } from './memory/store.js';
import { seedGraphFromNavigationMemory } from './memory/navigation-cache.js';
import { NetworkTrafficObserver } from './network/traffic-observer.js';
import { createContractIndex, type ContractIndex } from './spec/contract-index.js';
import { loadOpenApiSpec } from './spec/openapi-loader.js';
import { buildRepoSpec } from './spec/repo-spec.js';
import {
  startBootstrapProcess,
  stopBootstrapProcess,
  waitForBootstrapReady,
  type BootstrapStatus,
} from './engine/bootstrap.js';
import { emitEngineEvent, type EngineEventEmitter } from './engine/event-stream.js';
import { adaptStagehand } from './browser/page-interface.js';

function resolveBudget(config: DramaturgeConfig): BudgetConfig {
  return {
    globalTimeLimitSeconds: config.budget.globalTimeLimitSeconds ?? config.exploration.totalTimeout,
    maxStepsPerTask: config.budget.maxStepsPerTask ?? config.exploration.stepsPerArea,
    maxFrontierSize: config.budget.maxFrontierSize ?? 200,
    maxStateNodes: config.budget.maxStateNodes ?? 50,
    costLimitUsd: config.budget.costLimitUsd,
  };
}

function buildMission(config: DramaturgeConfig): MissionConfig | undefined {
  const enabledFocusModes: WorkerType[] = ['navigation', 'form', 'crud'];
  if (config.apiTesting.enabled) {
    enabledFocusModes.push('api');
  }
  if (config.adversarial.enabled) {
    enabledFocusModes.push('adversarial');
  }

  const focusModes =
    config.mission?.focusModes ?? (enabledFocusModes.length > 3 ? enabledFocusModes : undefined);

  if (!config.mission && !focusModes) return undefined;
  return {
    ...config.mission,
    appDescription: config.appDescription,
    destructiveActionsAllowed: config.mission?.destructiveActionsAllowed ?? false,
    focusModes,
  };
}

function handleNavFailure(ctx: EngineContext, item: FrontierItem, logPrefix = ''): void {
  console.log(`${logPrefix}  Navigation failed`);
  item.retryCount++;
  if (item.retryCount >= MAX_NAV_RETRIES) {
    ctx.globalCoverage.addBlindSpot({
      nodeId: item.nodeId,
      summary: `Unreachable: ${item.objective}`,
      reason: 'state-unreachable',
      severity: 'medium',
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

function loadRepoHints(config: DramaturgeConfig): RepoHints | undefined {
  if (!config.repoContext) return undefined;
  const configBaseDir =
    (config as Partial<LoadedDramaturgeConfig>)._meta?.configDir ?? process.cwd();

  const repoHints = scanRepository({
    root: config.repoContext.root ?? configBaseDir,
    framework: config.repoContext.framework,
    hintsFile: config.repoContext.hintsFile,
  });

  const hasHints =
    repoHints.routes.length > 0 ||
    repoHints.routeFamilies.length > 0 ||
    repoHints.stableSelectors.length > 0 ||
    repoHints.apiEndpoints.length > 0 ||
    repoHints.authHints.loginRoutes.length > 0 ||
    repoHints.authHints.callbackRoutes.length > 0 ||
    repoHints.expectedHttpNoise.length > 0;

  return hasHints ? repoHints : undefined;
}

function loadContractIndex(
  config: DramaturgeConfig,
  repoHints?: RepoHints
): ContractIndex | undefined {
  const artifacts = [];
  if (repoHints) {
    artifacts.push(buildRepoSpec(repoHints));
  }
  if (config.repoContext?.specFile) {
    artifacts.push(loadOpenApiSpec(config.repoContext.specFile));
  }

  return artifacts.length > 0 ? createContractIndex(artifacts) : undefined;
}

function loadDiffContext(
  config: DramaturgeConfig,
  repoHints: RepoHints | undefined,
  cliDiffRef?: string
): DiffContext | undefined {
  const baseRef = cliDiffRef ?? config.diffAware.baseRef;
  const enabled = cliDiffRef ? true : config.diffAware.enabled;

  if (!enabled || !baseRef) return undefined;

  const configBaseDir =
    (config as Partial<LoadedDramaturgeConfig>)._meta?.configDir ?? process.cwd();
  const repoRoot = config.repoContext?.root ?? configBaseDir;

  return buildDiffContext(baseRef, repoRoot, repoHints);
}

/** Propose seed tasks for a node, using the LLM planner if available. */
async function proposeSeedTasks(
  ctx: EngineContext,
  node: StateNode,
  useLLMPlanner: boolean
): Promise<FrontierItem[]> {
  const { config, mission } = ctx;
  if (useLLMPlanner) {
    return ctx.planner.proposeTasksWithLLM(
      node,
      ctx.graph,
      config.models.planner,
      mission,
      ctx.repoHints,
      config.llm.requestTimeoutMs,
      ctx.memoryStore?.getPlannerSignals(node),
      ctx.diffContext
    );
  }
  return ctx.planner.proposeTasks(
    node,
    ctx.graph,
    mission,
    ctx.repoHints,
    ctx.memoryStore?.getPlannerSignals(node),
    ctx.diffContext
  );
}

async function processTaskBatch(
  ctx: EngineContext,
  batchItems: FrontierItem[],
  taskNumberStart: number
): Promise<BatchTaskResult[]> {
  const primaryWorker: WorkerSession = {
    key: 'primary',
    stagehand: ctx.stagehand,
    page: ctx.page,
  };
  const workers = [primaryWorker, ...ctx.workerPool];

  const promises = batchItems.map(async (item, i): Promise<BatchTaskResult> => {
    const worker = workers[i % workers.length];
    const taskNumber = taskNumberStart + i;
    assignPageNodeOwner(ctx, worker.key, item.nodeId);

    emitEngineEvent(ctx.eventStream, 'task:start', {
      taskId: item.id,
      taskNumber,
      nodeId: item.nodeId,
      workerType: item.workerType,
      objective: item.objective,
    });

    const result = await executeFrontierItem({
      ctx,
      stagehand: worker.stagehand,
      page: worker.page,
      item,
      taskNumber,
      pageKey: worker.key,
    });

    if (!result.result) {
      handleNavFailure(ctx, item, workers.length > 1 ? `  [${taskNumber}]` : '');
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
  /** Optional event emitter for streaming engine progress. */
  eventStream?: EngineEventEmitter;
  /** Git ref to diff against for diff-aware exploration. Overrides config.diffAware.baseRef. */
  diffRef?: string;
}

export async function runEngine(
  config: DramaturgeConfig,
  options: RunEngineOptions = {}
): Promise<void> {
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputDir =
    resolveResumeDir(options.resumeDir, config as Partial<LoadedDramaturgeConfig>) ??
    join(config.output.dir, timestamp);
  const screenshotDir = join(outputDir, 'screenshots');
  mkdirSync(screenshotDir, { recursive: true });

  console.log(`Dramaturge v2 starting — target: ${config.targetUrl}`);
  console.log(`Output: ${outputDir}`);

  const eventStream = options.eventStream;
  const budget = resolveBudget(config);
  const mission = buildMission(config);
  const concurrency = config.concurrency.workers;
  const useLLMPlanner = hasLLMApiKey(config.models.planner);
  const repoHints = loadRepoHints(config);
  const contractIndex = loadContractIndex(config, repoHints);
  const diffContext = loadDiffContext(config, repoHints, options.diffRef);
  const policy = resolvePolicy(config.policy, repoHints);
  const memoryStore = config.memory.enabled ? new MemoryStore(config.memory.dir) : undefined;
  let warmStartApplied = false;
  let warmStartRestoredStateCount = 0;
  let bootstrapProcess: BootstrapStatus | undefined;

  if (repoHints) {
    console.log(
      `Repo-aware mode: ${repoHints.routes.length} routes, ${repoHints.stableSelectors.length} selectors, ${repoHints.expectedHttpNoise.length} expected-noise rule(s)`
    );
  }

  if (diffContext) {
    console.log(
      `Diff-aware mode: ${diffContext.changedFiles.length} changed file(s), ${diffContext.affectedRoutes.length} affected route(s), ${diffContext.affectedApiEndpoints.length} affected endpoint(s)`
    );
  }

  // Browser error auto-capture
  const errorCollector = new BrowserErrorCollector({
    captureConsole: config.autoCapture.consoleErrors,
    captureConsoleWarnings: config.autoCapture.consoleWarnings,
    captureNetwork: config.autoCapture.networkErrors,
    networkErrorMinStatus: config.autoCapture.networkErrorMinStatus,
    policy,
  });
  const trafficObserver = new NetworkTrafficObserver();

  // Initialize primary Stagehand
  const stagehand = createStagehand(config);
  await stagehand.init();
  errorCollector.attach(stagehand.context.pages()[0], 'primary');
  trafficObserver.attach(stagehand.context.pages()[0], 'primary');

  let workerPool: WorkerSession[] = [];

  // CostTracker is always instantiated for tracking; budget enforcement is only
  // active when costLimitUsd > 0 (default 0 means unlimited → Infinity).
  const costTracker = new CostTracker(
    budget.costLimitUsd && budget.costLimitUsd > 0 ? budget.costLimitUsd : Infinity
  );

  const planner = new Planner();
  planner.diffPriorityBoost = config.diffAware.priorityBoost;

  const ctx: EngineContext = {
    config,
    budget,
    mission,
    stagehand,
    page: stagehand.context.pages()[0],
    graph: new StateGraph(),
    frontier: new FrontierQueue(),
    planner,
    navigator: new Navigator(),
    globalCoverage: new CoverageTracker(),
    costTracker,
    screenshotDir,
    outputDir,
    findingsByNode: new Map(),
    evidenceByNode: new Map(),
    actionsByNode: new Map(),
    errorCollector,
    pageNodeOwners: new Map(),
    completedTaskIds: new Set(),
    workerPool,
    repoHints,
    contractIndex,
    diffContext,
    trafficObserver,
    memoryStore,
    eventStream,
    createIsolatedApiRequestContext: () =>
      playwrightRequest.newContext({
        baseURL: config.targetUrl,
      }),
  };

  emitEngineEvent(eventStream, 'run:start', {
    targetUrl: config.targetUrl,
    timestamp: startTime.toISOString(),
    budget: {
      timeLimitSeconds: budget.globalTimeLimitSeconds,
      maxStepsPerTask: budget.maxStepsPerTask,
    },
    concurrency,
  });

  try {
    bootstrapProcess = startBootstrapProcess(config);
    await waitForBootstrapReady(config, stagehand.context.pages()[0], bootstrapProcess, {
      newPage: () => stagehand.context.newPage(),
    });

    // Authenticate primary browser
    console.log(`\nAuthenticating (strategy: ${config.auth.type})...`);
    await authenticate(stagehand, config);
    console.log('Authentication successful.');
    memoryStore?.rememberAuthFromConfig(config);

    if (concurrency > 1) {
      const sharedWorkerState = await captureStorageState(
        adaptStagehand(stagehand),
        config.targetUrl
      );
      workerPool = await initWorkerPool(
        config,
        concurrency - 1,
        errorCollector,
        trafficObserver,
        sharedWorkerState
      );
      ctx.workerPool = workerPool;
      console.log(`Worker pool: ${concurrency} parallel browsers`);
    }

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
        ctx.actionsByNode = hydrated.actionsByNode;
        ctx.completedTaskIds = hydrated.completedTaskIds;
        ctx.planner.restoreDispatchState(hydrated.plannerState);
        tasksExecuted = hydrated.tasksExecuted;
        console.log(
          `Resumed from checkpoint: ${tasksExecuted} tasks, ${ctx.graph.nodeCount()} states, ${ctx.frontier.size()} pending`
        );
      }
    }

    if (
      !options.resumeDir &&
      ctx.graph.nodeCount() === 0 &&
      memoryStore &&
      config.memory.warmStart
    ) {
      const navigationSnapshot = memoryStore.getNavigationSnapshot(config.targetUrl);
      if (navigationSnapshot) {
        const warmStart = seedGraphFromNavigationMemory({
          graph: ctx.graph,
          frontier: ctx.frontier,
          planner: ctx.planner,
          snapshot: navigationSnapshot,
          mission: ctx.mission,
          repoHints: ctx.repoHints,
          memoryStore,
        });
        warmStartApplied = warmStart.restoredNodeCount > 0;
        warmStartRestoredStateCount = warmStart.restoredNodeCount;
        console.log(
          `Warm start restored ${warmStart.restoredNodeCount} state(s), ${warmStart.restoredEdgeCount} transition(s), and seeded ${warmStart.seededTaskCount} task(s)`
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
      console.log(`Root state: ${rootPageType} (fingerprint: ${rootFingerprint.hash})`);
      assignPageNodeOwner(ctx, 'primary', rootNode.id);

      // Seed initial tasks — use LLM planner if available
      const seedTasks = await proposeSeedTasks(ctx, rootNode, useLLMPlanner);
      ctx.frontier.enqueueMany(seedTasks);
      console.log(`Seeded frontier with ${seedTasks.length} tasks\n`);
    } else if (ctx.frontier.size() === 0) {
      const rootNode =
        ctx.graph.getAllNodes().find((node) => node.depth === 0) ?? ctx.graph.getAllNodes()[0];
      if (rootNode) {
        assignPageNodeOwner(ctx, 'primary', rootNode.id);
        const seedTasks = await proposeSeedTasks(ctx, rootNode, useLLMPlanner);
        ctx.frontier.enqueueMany(seedTasks);
        console.log(`Seeded frontier with ${seedTasks.length} warm-start task(s)\n`);
      }
    }

    const existingRootNode =
      ctx.graph.getAllNodes().find((node) => node.depth === 0) ?? ctx.graph.getAllNodes()[0];
    if (existingRootNode) {
      assignPageNodeOwner(ctx, 'primary', existingRootNode.id);
    }

    // === Main planner loop ===
    const startMs = Date.now();
    const checkpointInterval = config.checkpoint.intervalTasks;
    let tasksSinceCheckpoint = 0;
    let totalFindingsCount = 0;

    while (ctx.frontier.hasItems()) {
      const elapsedMs = Date.now() - startMs;
      if (elapsedMs > budget.globalTimeLimitSeconds * 1000) {
        console.log('Time budget exhausted.');
        break;
      }

      // Dequeue a batch of items (up to concurrency)
      const batchItems: FrontierItem[] = [];
      for (let i = 0; i < concurrency && ctx.frontier.hasItems(); i++) {
        const item = ctx.frontier.dequeueHighest();
        if (!item) break;
        // Skip already-completed tasks (from resume).
        // Setting status to "completed" removes them from hasItems() naturally.
        if (ctx.completedTaskIds.has(item.id)) {
          item.status = 'completed';
          i--; // don't count this toward batch size
          continue;
        }
        batchItems.push(item);
      }

      if (batchItems.length === 0) break;

      const batchResults = await processTaskBatch(ctx, batchItems, tasksExecuted + 1);

      // Collect results and expand graph
      for (const { item, result, pageKey } of batchResults) {
        flushOwnedBrowserErrors(ctx, pageKey);
        if (!result) continue;

        collectResults(ctx, item.nodeId, result);

        const coverageInfo =
          result.coverageSnapshot.controlsExercised > 0
            ? `, coverage: ${result.coverageSnapshot.controlsExercised}/${result.coverageSnapshot.controlsDiscovered}`
            : '';
        console.log(`  ${result.outcome}: ${result.findings.length} findings${coverageInfo}`);

        emitEngineEvent(eventStream, 'task:complete', {
          taskId: item.id,
          taskNumber: tasksExecuted + 1,
          nodeId: item.nodeId,
          outcome: result.outcome,
          findingsCount: result.findings.length,
          coverageExercised: result.coverageSnapshot.controlsExercised,
          coverageDiscovered: result.coverageSnapshot.controlsDiscovered,
        });

        for (const finding of result.findings) {
          emitEngineEvent(eventStream, 'finding', {
            taskId: item.id,
            title: finding.title,
            severity: finding.severity,
            category: finding.category,
          });
        }

        totalFindingsCount += result.findings.length;

        await expandGraph(ctx, item.nodeId, result, useLLMPlanner);
        routeFollowups(ctx, item.nodeId, result);

        item.status = 'completed';
        ctx.completedTaskIds.add(item.id);
        tasksExecuted++;
        tasksSinceCheckpoint++;
      }

      maintainFrontier(ctx);

      // Emit progress event after each batch
      const elapsedSinceStart = Date.now() - startMs;
      const timeBudgetMs = budget.globalTimeLimitSeconds * 1000;
      emitEngineEvent(eventStream, 'progress', {
        tasksExecuted,
        tasksRemaining: ctx.frontier.size(),
        totalFindings: totalFindingsCount,
        statesDiscovered: ctx.graph.nodeCount(),
        elapsedMs: elapsedSinceStart,
        estimatedProgress: Math.min(1, elapsedSinceStart / timeBudgetMs),
      });

      // Periodic checkpoint
      if (checkpointInterval > 0 && tasksSinceCheckpoint >= checkpointInterval) {
        saveCheckpoint(
          outputDir,
          ctx.graph,
          ctx.frontier,
          ctx.findingsByNode,
          ctx.evidenceByNode,
          ctx.actionsByNode,
          ctx.globalCoverage,
          [...ctx.completedTaskIds],
          tasksExecuted,
          ctx.planner.snapshotDispatchState()
        );
        tasksSinceCheckpoint = 0;
        console.log(`  Checkpoint saved (${tasksExecuted} tasks completed)`);
        emitEngineEvent(eventStream, 'checkpoint', {
          tasksExecuted,
          outputDir,
        });
      }

      // Navigate primary browser back to root
      try {
        const rootNode = ctx.graph.getAllNodes().find((node) => node.depth === 0);
        if (rootNode) {
          assignPageNodeOwner(ctx, 'primary', rootNode.id);
        }
        await ctx.page.goto(config.targetUrl);
      } catch {
        console.warn('  Failed to navigate back to root URL.');
      }
    }

    // Flush any remaining browser errors
    if (ctx.graph.nodeCount() > 0) {
      flushOwnedBrowserErrors(ctx, 'primary');
      for (const worker of ctx.workerPool) {
        flushOwnedBrowserErrors(ctx, worker.key);
      }
    }

    const finalFrontierSnapshot = checkpointInterval > 0 ? ctx.frontier.snapshot() : undefined;

    // Record remaining frontier as blind spots
    const remaining = ctx.frontier.drain();
    for (const r of remaining) {
      ctx.globalCoverage.addBlindSpot({
        nodeId: r.nodeId,
        summary: `Not reached: ${r.objective}`,
        reason: 'time-budget',
        severity: r.priority > 0.7 ? 'high' : 'low',
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
        ctx.actionsByNode,
        ctx.globalCoverage,
        [...ctx.completedTaskIds],
        tasksExecuted,
        ctx.planner.snapshotDispatchState(),
        {
          frontierSnapshot: finalFrontierSnapshot,
        }
      );
    }

    // Generate reports with per-node attribution
    const areaResults = buildAreaResults(ctx);
    if (memoryStore) {
      memoryStore.recordRunFindings(startTime.toISOString(), areaResults);
      memoryStore.recordObservedApiTraffic(startTime.toISOString(), trafficObserver.snapshot());
      memoryStore.recordNavigationSnapshot(config.targetUrl, ctx.graph);
      ctx.runMemory = memoryStore.getSummary(warmStartApplied, warmStartRestoredStateCount);
    }
    writeReports(ctx, startTime, areaResults, remaining);

    // Summary
    const blindSpots = ctx.globalCoverage.getBlindSpots();
    const totalFindings = [...ctx.findingsByNode.values()].reduce((sum, f) => sum + f.length, 0);
    console.log(
      `\nDone. ${tasksExecuted} tasks executed, ${totalFindings} finding(s), ${ctx.graph.nodeCount()} states discovered, ${blindSpots.length} blind spot(s).`
    );

    emitEngineEvent(eventStream, 'run:end', {
      timestamp: new Date().toISOString(),
      tasksExecuted,
      totalFindings,
      statesDiscovered: ctx.graph.nodeCount(),
      blindSpots: blindSpots.length,
      durationMs: Date.now() - startTime.getTime(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitEngineEvent(eventStream, 'run:error', { message, phase: 'engine' });
    console.error(`\nFatal error: ${message}`);
    throw error;
  } finally {
    errorCollector.detach();
    trafficObserver.detach();
    await closeWorkerPool(workerPool);
    await stagehand.context.close();
    stopBootstrapProcess(bootstrapProcess);
  }
}
