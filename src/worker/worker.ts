// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import type { AdversarialConfig, JudgeConfig } from '../config.js';
import { createWorkerTools } from './tools.js';
import { buildWorkerSystemPrompt } from './prompts.js';
import type {
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
import type { RepoHints } from '../adaptation/types.js';
import { ActionRecorder } from './action-recorder.js';
import type { WorkerHistoryContext } from '../memory/types.js';
import type { ObservedApiEndpoint } from '../network/traffic-observer.js';
import type { Observation } from '../judge/types.js';
import { judgeWorkerObservations } from '../judge/judge.js';
import { hasLLMApiKey, judgeObservationWithLLM } from '../llm.js';
import { mergeLedgerEntries } from '../ledger.js';
import type { Blackboard } from '../a2a/blackboard.js';

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
}) {
  return judgeWorkerObservations({
    observations: input.observations,
    evidence: input.evidence,
    actions: input.actionRecorder.getActions(),
    config: input.judgeConfig,
    judgeText:
      input.judgeConfig?.enabled !== false && input.judgeModel && hasLLMApiKey(input.judgeModel)
        ? (prompt, timeoutMs) =>
            judgeObservationWithLLM(input.judgeModel as string, prompt, timeoutMs)
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
}): Promise<StagehandAgentExecuteOutcome> {
  const execute = input.agent.execute as unknown as (
    args: StagehandAgentExecuteArgs
  ) => Promise<unknown>;
  const timeoutMs = input.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    try {
      return { kind: 'completed', result: await execute(input.args) };
    } catch (error) {
      return { kind: 'error', error };
    }
  }

  const controller = new AbortController();
  const executePromise = execute({ ...input.args, signal: controller.signal }).then(
    (result) => ({ kind: 'completed' as const, result }),
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

export interface ExecuteWorkerTaskOptions {
  model: string;
  screenshotDir: string;
  timeoutMs?: number;
  agentMode?: 'cua' | 'dom';
  screenshotsEnabled?: boolean;
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
      outcome: 'failed',
      summary: message,
    });
  } finally {
    actionRecorder.stop();
  }
}
