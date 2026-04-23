// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { request as playwrightRequest } from 'playwright';
import type { LoadedDramaturgeConfig, DramaturgeConfig } from './config.js';
import { resolveResumeDir } from './config-paths.js';
import type { BudgetConfig, MissionConfig, WorkerType } from './types.js';
import { authenticate } from './auth/authenticator.js';
import { captureStorageState } from './auth/storage-state.js';
import { StateGraph } from './graph/state-graph.js';
import { FrontierQueue } from './graph/frontier.js';
import { Planner } from './planner/planner.js';
import { Navigator } from './planner/navigator.js';
import { CoverageTracker } from './coverage/tracker.js';
import { CostTracker } from './coverage/cost-tracker.js';
import { BrowserErrorCollector } from './browser-errors.js';
import { hasLLMApiKey } from './llm.js';
import type { EngineContext } from './engine/context.js';
import type { WorkerSession } from './engine/worker-pool.js';
import { initWorkerPool, closeWorkerPool, createStagehand } from './engine/worker-pool.js';
import { scanRepository } from './adaptation/repo-scan.js';
import type { RepoHints } from './adaptation/types.js';
import { buildDiffContext } from './diff/diff-hints.js';
import type { DiffContext } from './diff/types.js';
import { resolvePolicy } from './policy/policy.js';
import { MemoryStore } from './memory/store.js';
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
import { createEngineLogger } from './engine/logger.js';
import { finalizeRun } from './engine/finalize-run.js';
import { runPlannerLoop } from './engine/main-loop.js';
import {
  applyWarmStart,
  restoreCheckpointState,
  seedFrontierIfNeeded,
} from './engine/run-state.js';

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

  const eventStream = options.eventStream;
  const logger = createEngineLogger(eventStream);
  const budget = resolveBudget(config);
  const mission = buildMission(config);
  const concurrency = config.concurrency.workers;
  const useLLMPlanner = hasLLMApiKey(config.models.planner);
  const repoHints = loadRepoHints(config);
  const contractIndex = loadContractIndex(config, repoHints);
  const diffContext = loadDiffContext(config, repoHints, options.diffRef);
  const policy = resolvePolicy(config.policy, repoHints);
  const memoryStore = config.memory.enabled ? new MemoryStore(config.memory.dir) : undefined;
  let bootstrapProcess: BootstrapStatus | undefined;

  logger.info('Starting engine run', {
    targetUrl: config.targetUrl,
    outputDir,
    concurrency,
    llmPlannerEnabled: useLLMPlanner,
  });

  if (repoHints) {
    logger.info('Repo-aware mode enabled', {
      routes: repoHints.routes.length,
      stableSelectors: repoHints.stableSelectors.length,
      expectedNoiseRules: repoHints.expectedHttpNoise.length,
    });
  }

  if (diffContext) {
    logger.info('Diff-aware mode enabled', {
      changedFiles: diffContext.changedFiles.length,
      affectedRoutes: diffContext.affectedRoutes.length,
      affectedEndpoints: diffContext.affectedApiEndpoints.length,
    });
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
    logger,
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
    bootstrapProcess = startBootstrapProcess(
      config,
      undefined,
      undefined,
      logger.child('bootstrap')
    );
    await waitForBootstrapReady(config, stagehand.context.pages()[0], bootstrapProcess, {
      logger: logger.child('bootstrap'),
      newPage: () => stagehand.context.newPage(),
    });

    // Authenticate primary browser
    logger.info('Authenticating primary browser', {
      strategy: config.auth.type,
    });
    await authenticate(stagehand, config);
    logger.info('Authentication successful');
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
      logger.info('Initialized worker pool', {
        workers: concurrency,
      });
    }

    const tasksExecuted = restoreCheckpointState(ctx, options.resumeDir);
    const warmStartState = applyWarmStart(ctx, options.resumeDir);
    await seedFrontierIfNeeded(ctx, useLLMPlanner);

    const checkpointInterval = config.checkpoint.intervalTasks;
    const loopResult = await runPlannerLoop(ctx, {
      initialTasksExecuted: tasksExecuted,
      useLLMPlanner,
      checkpointInterval,
      startMs: Date.now(),
    });

    finalizeRun(ctx, {
      startTime,
      tasksExecuted: loopResult.tasksExecuted,
      warmStartApplied: warmStartState.warmStartApplied,
      warmStartRestoredStateCount: warmStartState.warmStartRestoredStateCount,
      checkpointInterval,
      finalFrontierSnapshot: loopResult.finalFrontierSnapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitEngineEvent(eventStream, 'run:error', { message, phase: 'engine' });
    logger.error('Fatal engine error', { message });
    throw error;
  } finally {
    errorCollector.detach();
    trafficObserver.detach();
    await closeWorkerPool(workerPool);
    await stagehand.context.close();
    stopBootstrapProcess(bootstrapProcess);
  }
}
