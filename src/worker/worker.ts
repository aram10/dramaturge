// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import type { AdversarialConfig, JudgeConfig } from '../config.js';
import { createWorkerTools } from './tools.js';
import { buildWorkerSystemPrompt } from './prompts.js';
import type {
  Area,
  AreaResult,
  Evidence,
  PageType,
  WorkerTask,
  WorkerResult,
  FollowupRequest,
  DiscoveredEdge,
  MissionConfig,
  AgentRole,
} from '../types.js';
import { CoverageTracker } from '../coverage/tracker.js';
import { StagnationTracker } from './stagnation.js';
import { captureFingerprint } from '../graph/fingerprint.js';
import { classifyPage } from '../planner/page-classifier.js';
import type { RepoHints } from '../adaptation/types.js';
import { ActionRecorder } from './action-recorder.js';
import type { WorkerHistoryContext } from '../memory/types.js';
import type { ObservedApiEndpoint } from '../network/traffic-observer.js';
import type { Observation } from '../judge/types.js';
import { judgeWorkerObservations } from '../judge/judge.js';
import { hasLLMApiKey, judgeObservationWithLLM } from '../llm.js';
import { mergeLedgerEntries } from '../ledger.js';
import type { Blackboard } from '../a2a/blackboard.js';
import { approximateTokenCount, type CostTracker } from '../coverage/cost-tracker.js';

type StagehandToolSet = NonNullable<Parameters<Stagehand['agent']>[0]>['tools'];

interface WorkerSetup {
  observations: Observation[];
  screenshots: Map<string, Buffer>;
  evidence: Evidence[];
  coverageTracker: CoverageTracker;
  followupRequests: FollowupRequest[];
  discoveredEdges: DiscoveredEdge[];
  actionRecorder: ActionRecorder;
  agent: ReturnType<Stagehand['agent']>;
}

interface SafetyGuardLike {
  checkUrl(url: string): string | null;
}

function initWorker(
  stagehand: Stagehand,
  opts: {
    screenshotDir: string;
    areaName: string;
    appDescription: string;
    objectiveLabel: string;
    objectiveDescription?: string;
    pageType: PageType;
    agentMode: 'cua' | 'dom';
    model: string;
    screenshotsEnabled: boolean;
    stagnationThreshold: number;
    appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] };
    repoHints?: RepoHints;
    contractSummary?: string[];
    observedApiEndpoints?: ObservedApiEndpoint[];
    mission?: MissionConfig;
    history?: WorkerHistoryContext;
    stateId?: string;
    workerType?: WorkerTask['workerType'];
    adversarialConfig?: AdversarialConfig;
    judgeConfig?: JudgeConfig;
    visionContext?: string;
    safetyGuard?: SafetyGuardLike;
    /** A2A agent role; enables role-specific prompt sections when set. */
    agentRole?: AgentRole;
    /** Recent blackboard summary for context injection into worker system prompt. */
    blackboardSummary?: string;
    /** Shared blackboard; enables the post_to_blackboard tool when set. */
    blackboard?: Blackboard;
    /** Agent identifier used when posting entries to the blackboard. */
    agentId?: string;
  }
): WorkerSetup {
  const observations: Observation[] = [];
  const screenshots = new Map<string, Buffer>();
  const evidence: Evidence[] = [];
  const coverageTracker = new CoverageTracker();
  const followupRequests: FollowupRequest[] = [];
  const discoveredEdges: DiscoveredEdge[] = [];
  const page = stagehand.context.pages()[0];
  const actionRecorder = new ActionRecorder(page, {
    afterAction: () => {
      if (!opts.safetyGuard || typeof page.url !== 'function') {
        return;
      }
      const blocked = opts.safetyGuard.checkUrl(page.url());
      if (blocked) {
        throw new Error(`Blocked page URL by safety guard: ${blocked}`);
      }
    },
  });
  actionRecorder.start();

  const stagnationTracker =
    opts.stagnationThreshold > 0 ? new StagnationTracker(opts.stagnationThreshold) : undefined;

  const tools = createWorkerTools({
    observations,
    screenshots,
    evidence,
    coverageTracker,
    page,
    screenshotDir: opts.screenshotDir,
    areaName: opts.areaName,
    followupRequests,
    discoveredEdges,
    screenshotsEnabled: opts.screenshotsEnabled,
    stagnationTracker,
    findingContext: {
      stateId: opts.stateId,
      objective: opts.objectiveDescription
        ? `${opts.objectiveLabel}: ${opts.objectiveDescription}`
        : opts.objectiveLabel,
    },
    actionRecorder,
    blackboard: opts.blackboard,
    agentId: opts.agentId,
  });
  const stagehandTools: StagehandToolSet = tools;

  const systemPrompt = buildWorkerSystemPrompt({
    appDescription: opts.appDescription,
    areaName: opts.objectiveLabel,
    areaDescription: opts.objectiveDescription,
    pageType: opts.pageType,
    appContext: opts.appContext,
    repoHints: opts.repoHints,
    contractSummary: opts.contractSummary,
    observedApiEndpoints: opts.observedApiEndpoints,
    mission: opts.mission,
    history: opts.history,
    workerType: opts.workerType,
    adversarialConfig: opts.adversarialConfig,
    visionContext: opts.visionContext,
    agentRole: opts.agentRole,
    blackboardSummary: opts.blackboardSummary,
  });

  const agent = stagehand.agent({
    mode: opts.agentMode,
    model: opts.model,
    systemPrompt,
    tools: stagehandTools,
  });

  return {
    observations,
    screenshots,
    evidence,
    coverageTracker,
    followupRequests,
    discoveredEdges,
    actionRecorder,
    agent,
  };
}

async function materializeObservedFindings(input: {
  observations: Observation[];
  evidence: Evidence[];
  actionRecorder: ActionRecorder;
  judgeConfig?: JudgeConfig;
  judgeModel?: string;
  costTracker?: CostTracker;
  costLabel?: string;
}) {
  return judgeWorkerObservations({
    observations: input.observations,
    evidence: input.evidence,
    actions: input.actionRecorder.getActions(),
    config: input.judgeConfig,
    judgeText:
      input.judgeConfig?.enabled !== false && input.judgeModel && hasLLMApiKey(input.judgeModel)
        ? (prompt, timeoutMs) =>
            judgeObservationWithLLM(input.judgeModel as string, prompt, timeoutMs, {
              costTracker: input.costTracker,
              costLabel: input.costLabel ?? 'judge:observation',
            })
        : undefined,
  });
}

async function safeStagehandActions(result: unknown): Promise<unknown> {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  return record.actions;
}

async function materializeObservedFindingsSafe(input: {
  observations: WorkerSetup['observations'];
  evidence: WorkerSetup['evidence'];
  actionRecorder: WorkerSetup['actionRecorder'];
  judgeConfig?: JudgeConfig;
  judgeModel?: string;
  costTracker?: CostTracker;
  costLabel?: string;
}): Promise<Awaited<ReturnType<typeof materializeObservedFindings>>> {
  try {
    return await materializeObservedFindings(input);
  } catch {
    return [];
  }
}

async function buildWorkerExecutionResult(input: {
  task: WorkerTask;
  model: string;
  judgeConfig?: JudgeConfig;
  observations: WorkerSetup['observations'];
  evidence: WorkerSetup['evidence'];
  actionRecorder: WorkerSetup['actionRecorder'];
  coverageTracker: WorkerSetup['coverageTracker'];
  followupRequests: WorkerSetup['followupRequests'];
  discoveredEdges: WorkerSetup['discoveredEdges'];
  observedApiEndpoints?: ObservedApiEndpoint[];
  costTracker?: CostTracker;
  stagehandResult?: unknown;
  outcome: WorkerResult['outcome'];
  summary: string;
}): Promise<WorkerResult> {
  const findings = await materializeObservedFindingsSafe({
    observations: input.observations,
    evidence: input.evidence,
    actionRecorder: input.actionRecorder,
    judgeConfig: input.judgeConfig,
    judgeModel: input.model,
    costTracker: input.costTracker,
    costLabel: `worker:${input.task.id}:judge`,
  });
  const stagehandActions = input.stagehandResult
    ? await safeStagehandActions(input.stagehandResult)
    : undefined;
  const explorationLedger = mergeLedgerEntries({
    actionRecorderActions: input.actionRecorder.getActions(),
    ...(stagehandActions ? { stagehandActions } : {}),
    evidence: input.evidence,
    findings,
    observedApiEndpoints: input.observedApiEndpoints,
    context: {
      areaName: input.task.nodeId,
      stateId: input.task.nodeId,
      taskId: input.task.id,
    },
  });

  return {
    taskId: input.task.id,
    findings,
    evidence: input.evidence,
    replayableActions: input.actionRecorder.getActions(),
    coverageSnapshot: input.coverageTracker.snapshot(),
    followupRequests: input.followupRequests,
    discoveredEdges: input.discoveredEdges,
    explorationLedger,
    outcome: input.outcome,
    summary: input.summary,
  };
}

interface StagehandAgentExecuteArgs {
  instruction: string;
  maxSteps: number;
  signal?: AbortSignal;
}

type StagehandAgentExecuteOutcome =
  | { kind: 'completed'; result: unknown }
  | { kind: 'timed-out' }
  | { kind: 'error'; error: unknown };

async function runStagehandExecute(input: {
  agent: WorkerSetup['agent'];
  args: StagehandAgentExecuteArgs;
  timeoutMs?: number;
  model?: string;
  costTracker?: CostTracker;
  costLabel?: string;
}): Promise<StagehandAgentExecuteOutcome> {
  const execute = input.agent.execute as unknown as (
    args: StagehandAgentExecuteArgs
  ) => Promise<unknown>;
  const timeoutMs = input.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    try {
      const result = await execute(input.args);
      recordStagehandCost(input, result);
      return { kind: 'completed', result };
    } catch (error) {
      return { kind: 'error', error };
    }
  }

  const controller = new AbortController();
  const executePromise = execute({ ...input.args, signal: controller.signal }).then(
    (result) => {
      recordStagehandCost(input, result);
      return { kind: 'completed' as const, result };
    },
    (error) => ({ kind: 'error' as const, error })
  );

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<StagehandAgentExecuteOutcome>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ kind: 'timed-out' });
      controller.abort();
    }, timeoutMs);
  });

  const outcome = await Promise.race([executePromise, timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  return outcome;
}

function recordStagehandCost(
  input: {
    args: StagehandAgentExecuteArgs;
    model?: string;
    costTracker?: CostTracker;
    costLabel?: string;
  },
  result: unknown
): void {
  if (!input.model || !input.costTracker) {
    return;
  }
  const usage = extractStagehandUsage(result);
  let output: string;
  try {
    output = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  } catch {
    output = '';
  }
  input.costTracker.record(
    input.model,
    usage?.inputTokens ?? approximateTokenCount(input.args.instruction),
    usage?.outputTokens ?? approximateTokenCount(output),
    input.costLabel ?? 'worker:stagehand',
    { source: usage ? 'reported' : 'estimated' }
  );
}

function extractStagehandUsage(
  result: unknown
): { inputTokens: number; outputTokens: number } | null {
  const usage = (
    result as {
      usage?: {
        promptTokens?: unknown;
        completionTokens?: unknown;
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        inputTokens?: unknown;
        outputTokens?: unknown;
      };
    }
  ).usage;
  if (!usage) {
    return null;
  }

  const inputTokens =
    typeof usage.promptTokens === 'number'
      ? usage.promptTokens
      : typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : typeof usage.inputTokens === 'number'
          ? usage.inputTokens
          : undefined;
  const outputTokens =
    typeof usage.completionTokens === 'number'
      ? usage.completionTokens
      : typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : typeof usage.outputTokens === 'number'
          ? usage.outputTokens
          : undefined;
  if (inputTokens === undefined && outputTokens === undefined) {
    return null;
  }

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

export interface ExploreAreaOptions {
  appDescription: string;
  model: string;
  stepsPerArea: number;
  screenshotDir: string;
  agentMode?: 'cua' | 'dom';
  screenshotsEnabled?: boolean;
  stagnationThreshold?: number;
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] };
  repoHints?: RepoHints;
  contractSummary?: string[];
  observedApiEndpoints?: ObservedApiEndpoint[];
  mission?: MissionConfig;
  history?: WorkerHistoryContext;
  judgeConfig?: JudgeConfig;
  safetyGuard?: SafetyGuardLike;
  costTracker?: CostTracker;
}

export async function exploreArea(
  stagehand: Stagehand,
  area: Area,
  opts: ExploreAreaOptions
): Promise<AreaResult> {
  const {
    appDescription,
    model,
    stepsPerArea,
    screenshotDir,
    agentMode = 'cua',
    screenshotsEnabled = true,
    stagnationThreshold = 0,
    appContext,
    repoHints,
    contractSummary,
    observedApiEndpoints,
    mission,
    history,
    judgeConfig,
    safetyGuard,
    costTracker,
  } = opts;
  // Classify the page and capture fingerprint before starting the worker
  const page = stagehand.context.pages()[0];
  let pageType: PageType = 'unknown';
  let fingerprint;
  try {
    [pageType, fingerprint] = await Promise.all([classifyPage(page), captureFingerprint(page)]);
  } catch {
    // Page classification or fingerprinting failed; continue with defaults
  }

  const { observations, screenshots, evidence, coverageTracker, actionRecorder, agent } =
    initWorker(stagehand, {
      screenshotDir,
      areaName: area.name,
      appDescription,
      objectiveLabel: area.name,
      objectiveDescription: area.description,
      pageType,
      agentMode,
      model,
      screenshotsEnabled,
      stagnationThreshold,
      appContext,
      repoHints,
      contractSummary,
      observedApiEndpoints,
      mission,
      history,
      judgeConfig,
      safetyGuard,
    });

  const instruction = `Explore the "${area.name}" area of this application. Interact with all visible elements, test forms, check edge cases, and report any issues you find using the log_finding tool. Take screenshots before logging findings and include the evidenceId. Use mark_control_exercised after each interaction to track coverage.`;

  try {
    const result = await agent.execute({
      instruction,
      maxSteps: stepsPerArea,
    });
    recordStagehandCost(
      {
        args: {
          instruction,
          maxSteps: stepsPerArea,
        },
        model,
        costTracker,
        costLabel: `area:${area.name}:stagehand`,
      },
      result
    );

    const stepCount =
      'actions' in result && Array.isArray(result.actions) ? result.actions.length : 0;

    const findings = await materializeObservedFindings({
      observations,
      evidence,
      actionRecorder,
      judgeConfig,
      judgeModel: model,
      costTracker,
      costLabel: `area:${area.name}:judge`,
    });
    const stagehandActions = await safeStagehandActions(result);
    const explorationLedger = mergeLedgerEntries({
      actionRecorderActions: actionRecorder.getActions(),
      stagehandActions,
      evidence,
      findings,
      observedApiEndpoints,
      context: { areaName: area.name },
    });

    return {
      name: area.name,
      url: area.url,
      steps: stepCount,
      findings,
      replayableActions: actionRecorder.getActions(),
      screenshots,
      evidence,
      coverage: coverageTracker.snapshot(),
      pageType,
      fingerprint,
      explorationLedger,
      status: 'explored' as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    let findings: Awaited<ReturnType<typeof materializeObservedFindings>> = [];
    try {
      findings = await materializeObservedFindings({
        observations,
        evidence,
        actionRecorder,
        judgeConfig,
        judgeModel: model,
        costTracker,
        costLabel: `area:${area.name}:judge`,
      });
    } catch {
      // Judge failed to materialize findings; return empty findings array
    }

    const explorationLedger = mergeLedgerEntries({
      actionRecorderActions: actionRecorder.getActions(),
      evidence,
      findings,
      observedApiEndpoints,
      context: { areaName: area.name },
    });

    return {
      name: area.name,
      url: area.url,
      steps: 0,
      findings,
      replayableActions: actionRecorder.getActions(),
      screenshots,
      evidence,
      coverage: coverageTracker.snapshot(),
      pageType,
      fingerprint,
      explorationLedger,
      status: 'failed',
      failureReason: message,
    };
  } finally {
    actionRecorder.stop();
  }
}

export interface ExecuteWorkerTaskOptions {
  model: string;
  screenshotDir: string;
  timeoutMs?: number;
  agentMode?: 'cua' | 'dom';
  screenshotsEnabled?: boolean;
  stagnationThreshold?: number;
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] };
  repoHints?: RepoHints;
  contractSummary?: string[];
  observedApiEndpoints?: ObservedApiEndpoint[];
  mission?: MissionConfig;
  history?: WorkerHistoryContext;
  adversarialConfig?: AdversarialConfig;
  judgeConfig?: JudgeConfig;
  visionContext?: string;
  safetyGuard?: SafetyGuardLike;
  costTracker?: CostTracker;
  /** A2A multi-agent context (optional). */
  a2aContext?: {
    agentRole: AgentRole;
    agentId: string;
    blackboard?: Blackboard;
    blackboardSummary?: string;
  };
}

export async function executeWorkerTask(
  stagehand: Stagehand,
  task: WorkerTask,
  opts: ExecuteWorkerTaskOptions
): Promise<WorkerResult> {
  const {
    model,
    screenshotDir,
    timeoutMs,
    agentMode = 'cua',
    screenshotsEnabled = true,
    stagnationThreshold = 0,
    appContext,
    repoHints,
    contractSummary,
    observedApiEndpoints,
    mission,
    history,
    adversarialConfig,
    judgeConfig,
    visionContext,
    safetyGuard,
    costTracker,
    a2aContext,
  } = opts;
  const {
    observations,
    evidence,
    coverageTracker,
    followupRequests,
    discoveredEdges,
    actionRecorder,
    agent,
  } = initWorker(stagehand, {
    screenshotDir,
    areaName: task.nodeId,
    appDescription: task.missionContext ?? '',
    objectiveLabel: task.objective,
    pageType: task.pageType,
    agentMode,
    model,
    screenshotsEnabled,
    stagnationThreshold,
    appContext,
    repoHints,
    contractSummary,
    observedApiEndpoints,
    mission,
    history,
    stateId: task.nodeId,
    workerType: task.workerType,
    adversarialConfig,
    judgeConfig,
    visionContext,
    safetyGuard,
    agentRole: a2aContext?.agentRole,
    blackboardSummary: a2aContext?.blackboardSummary,
    blackboard: a2aContext?.blackboard,
    agentId: a2aContext?.agentId,
  });

  try {
    const executeOutcome = await runStagehandExecute({
      agent,
      args: {
        instruction:
          task.workerType === 'adversarial'
            ? `${task.objective}\nPrioritize stale-state, replay, idempotency, and boundary-value probes. Stay read-only unless the run explicitly allows mutation-dependent adversarial sequences.`
            : task.objective,
        maxSteps: task.maxSteps,
      },
      timeoutMs,
      model,
      costTracker,
      costLabel: `worker:${task.id}:stagehand`,
    });

    if (executeOutcome.kind === 'completed') {
      return await buildWorkerExecutionResult({
        task,
        model,
        judgeConfig,
        observations,
        evidence,
        actionRecorder,
        coverageTracker,
        followupRequests,
        discoveredEdges,
        observedApiEndpoints,
        costTracker,
        stagehandResult: executeOutcome.result,
        outcome: 'completed',
        summary: `Completed ${task.workerType} task: ${task.objective}`,
      });
    }

    if (executeOutcome.kind === 'timed-out') {
      return await buildWorkerExecutionResult({
        task,
        model,
        judgeConfig,
        observations,
        evidence,
        actionRecorder,
        coverageTracker,
        followupRequests,
        discoveredEdges,
        observedApiEndpoints,
        costTracker,
        outcome: 'timed-out',
        summary: timeoutMs ? `Timed out after ${timeoutMs}ms` : 'Timed out',
      });
    }

    const message =
      executeOutcome.error instanceof Error
        ? executeOutcome.error.message
        : String(executeOutcome.error);
    return await buildWorkerExecutionResult({
      task,
      model,
      judgeConfig,
      observations,
      evidence,
      actionRecorder,
      coverageTracker,
      followupRequests,
      discoveredEdges,
      observedApiEndpoints,
      costTracker,
      outcome: 'failed',
      summary: message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return await buildWorkerExecutionResult({
      task,
      model,
      judgeConfig,
      observations,
      evidence,
      actionRecorder,
      coverageTracker,
      followupRequests,
      discoveredEdges,
      observedApiEndpoints,
      costTracker,
      outcome: 'failed',
      summary: message,
    });
  } finally {
    actionRecorder.stop();
  }
}
