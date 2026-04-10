// SPDX-License-Identifier: GPL-3.0-only
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
  }
): WorkerSetup {
  const observations: Observation[] = [];
  const screenshots = new Map<string, Buffer>();
  const evidence: Evidence[] = [];
  const coverageTracker = new CoverageTracker();
  const followupRequests: FollowupRequest[] = [];
  const discoveredEdges: DiscoveredEdge[] = [];
  const page = stagehand.context.pages()[0];
  const actionRecorder = new ActionRecorder(page);
  actionRecorder.start();

  const stagnationTracker =
    opts.stagnationThreshold > 0 ? new StagnationTracker(opts.stagnationThreshold) : undefined;

  const tools = createWorkerTools(
    observations,
    screenshots,
    evidence,
    coverageTracker,
    page,
    opts.screenshotDir,
    opts.areaName,
    followupRequests,
    discoveredEdges,
    opts.screenshotsEnabled,
    {
      stagnationTracker,
      findingContext: {
        stateId: opts.stateId,
        objective: opts.objectiveDescription
          ? `${opts.objectiveLabel}: ${opts.objectiveDescription}`
          : opts.objectiveLabel,
      },
      actionRecorder,
    }
  );
  const stagehandTools: StagehandToolSet = tools;

  const systemPrompt = buildWorkerSystemPrompt(
    opts.appDescription,
    opts.objectiveLabel,
    opts.objectiveDescription,
    opts.pageType,
    opts.appContext,
    opts.repoHints,
    opts.contractSummary,
    opts.observedApiEndpoints,
    opts.mission,
    opts.history,
    opts.workerType,
    opts.adversarialConfig,
    opts.visionContext
  );

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

export async function exploreArea(
  stagehand: Stagehand,
  area: Area,
  appDescription: string,
  model: string,
  stepsPerArea: number,
  screenshotDir: string,
  agentMode: 'cua' | 'dom' = 'cua',
  screenshotsEnabled = true,
  stagnationThreshold = 0,
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] },
  repoHints?: RepoHints,
  contractSummary?: string[],
  observedApiEndpoints?: ObservedApiEndpoint[],
  mission?: MissionConfig,
  history?: WorkerHistoryContext,
  judgeConfig?: JudgeConfig
): Promise<AreaResult> {
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
    });

  try {
    const result = await agent.execute({
      instruction: `Explore the "${area.name}" area of this application. Interact with all visible elements, test forms, check edge cases, and report any issues you find using the log_finding tool. Take screenshots before logging findings and include the evidenceId. Use mark_control_exercised after each interaction to track coverage.`,
      maxSteps: stepsPerArea,
    });

    const stepCount =
      'actions' in result && Array.isArray(result.actions) ? result.actions.length : 0;

    return {
      name: area.name,
      url: area.url,
      steps: stepCount,
      findings: await materializeObservedFindings({
        observations,
        evidence,
        actionRecorder,
        judgeConfig,
        judgeModel: model,
      }),
      replayableActions: actionRecorder.getActions(),
      screenshots,
      evidence,
      coverage: coverageTracker.snapshot(),
      pageType,
      fingerprint,
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
      });
    } catch {
      // Judge failed to materialize findings; return empty findings array
    }

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
      status: 'failed',
      failureReason: message,
    };
  } finally {
    actionRecorder.stop();
  }
}

export async function executeWorkerTask(
  stagehand: Stagehand,
  task: WorkerTask,
  model: string,
  screenshotDir: string,
  agentMode: 'cua' | 'dom' = 'cua',
  screenshotsEnabled = true,
  stagnationThreshold = 0,
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] },
  repoHints?: RepoHints,
  contractSummary?: string[],
  observedApiEndpoints?: ObservedApiEndpoint[],
  mission?: MissionConfig,
  history?: WorkerHistoryContext,
  adversarialConfig?: AdversarialConfig,
  judgeConfig?: JudgeConfig,
  visionContext?: string
): Promise<WorkerResult> {
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
  });

  try {
    await agent.execute({
      instruction:
        task.workerType === 'adversarial'
          ? `${task.objective}\nPrioritize stale-state, replay, idempotency, and boundary-value probes. Stay read-only unless the run explicitly allows mutation-dependent adversarial sequences.`
          : task.objective,
      maxSteps: task.maxSteps,
    });

    return {
      taskId: task.id,
      findings: await materializeObservedFindings({
        observations,
        evidence,
        actionRecorder,
        judgeConfig,
        judgeModel: model,
      }),
      evidence,
      replayableActions: actionRecorder.getActions(),
      coverageSnapshot: coverageTracker.snapshot(),
      followupRequests,
      discoveredEdges,
      outcome: 'completed',
      summary: `Completed ${task.workerType} task: ${task.objective}`,
    };
  } catch (error) {
    let findings: Awaited<ReturnType<typeof materializeObservedFindings>> = [];
    try {
      findings = await materializeObservedFindings({
        observations,
        evidence,
        actionRecorder,
        judgeConfig,
        judgeModel: model,
      });
    } catch {
      // Judge failed to materialize findings; return empty findings array
    }

    return {
      taskId: task.id,
      findings,
      evidence,
      replayableActions: actionRecorder.getActions(),
      coverageSnapshot: coverageTracker.snapshot(),
      followupRequests,
      discoveredEdges,
      outcome: 'failed',
      summary: error instanceof Error ? error.message : String(error),
    };
  } finally {
    actionRecorder.stop();
  }
}
