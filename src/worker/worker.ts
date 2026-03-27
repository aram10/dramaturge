import type { Stagehand } from "@browserbasehq/stagehand";
import { createWorkerTools } from "./tools.js";
import { buildWorkerSystemPrompt } from "./prompts.js";
import type {
  Area,
  AreaResult,
  RawFinding,
  Evidence,
  PageType,
  WorkerTask,
  WorkerResult,
  FollowupRequest,
  DiscoveredEdge,
  MissionConfig,
} from "../types.js";
import { CoverageTracker } from "../coverage/tracker.js";
import { StagnationTracker } from "./stagnation.js";
import { captureFingerprint } from "../graph/fingerprint.js";
import { classifyPage } from "../planner/page-classifier.js";
import type { RepoHints } from "../adaptation/types.js";
import { ActionRecorder } from "./action-recorder.js";
import type { WorkerHistoryContext } from "../memory/types.js";
import type { ObservedApiEndpoint } from "../network/traffic-observer.js";

interface WorkerSetup {
  findings: RawFinding[];
  screenshots: Map<string, Buffer>;
  evidence: Evidence[];
  coverageTracker: CoverageTracker;
  followupRequests: FollowupRequest[];
  discoveredEdges: DiscoveredEdge[];
  actionRecorder: ActionRecorder;
  agent: ReturnType<Stagehand["agent"]>;
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
    agentMode: "cua" | "dom";
    model: string;
    screenshotsEnabled: boolean;
    stagnationThreshold: number;
    appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] };
    repoHints?: RepoHints;
    observedApiEndpoints?: ObservedApiEndpoint[];
    mission?: MissionConfig;
    history?: WorkerHistoryContext;
    stateId?: string;
  }
): WorkerSetup {
  const findings: RawFinding[] = [];
  const screenshots = new Map<string, Buffer>();
  const evidence: Evidence[] = [];
  const coverageTracker = new CoverageTracker();
  const followupRequests: FollowupRequest[] = [];
  const discoveredEdges: DiscoveredEdge[] = [];
  const page = stagehand.context.pages()[0];
  const actionRecorder = new ActionRecorder(page as any);
  actionRecorder.start();

  const stagnationTracker = opts.stagnationThreshold > 0
    ? new StagnationTracker(opts.stagnationThreshold)
    : undefined;

  const tools = createWorkerTools(
    findings, screenshots, evidence, coverageTracker, page,
    opts.screenshotDir, opts.areaName,
    followupRequests, discoveredEdges,
    opts.screenshotsEnabled,
    stagnationTracker,
    {
      stateId: opts.stateId,
      objective: opts.objectiveDescription
        ? `${opts.objectiveLabel}: ${opts.objectiveDescription}`
        : opts.objectiveLabel,
    },
    actionRecorder
  );

  const systemPrompt = buildWorkerSystemPrompt(
    opts.appDescription,
    opts.objectiveLabel,
    opts.objectiveDescription,
    opts.pageType,
    opts.appContext,
    opts.repoHints,
    opts.observedApiEndpoints,
    opts.mission,
    opts.history
  );

  const agent = stagehand.agent({
    mode: opts.agentMode,
    model: opts.model,
    systemPrompt,
    tools: tools as any,
  });

  return {
    findings,
    screenshots,
    evidence,
    coverageTracker,
    followupRequests,
    discoveredEdges,
    actionRecorder,
    agent,
  };
}

export async function exploreArea(
  stagehand: Stagehand,
  area: Area,
  appDescription: string,
  model: string,
  stepsPerArea: number,
  screenshotDir: string,
  agentMode: "cua" | "dom" = "cua",
  screenshotsEnabled = true,
  stagnationThreshold = 0,
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] },
  repoHints?: RepoHints,
  observedApiEndpoints?: ObservedApiEndpoint[],
  mission?: MissionConfig,
  history?: WorkerHistoryContext
): Promise<AreaResult> {
  // Classify the page and capture fingerprint before starting the worker
  const page = stagehand.context.pages()[0];
  let pageType: PageType = "unknown";
  let fingerprint;
  try {
    [pageType, fingerprint] = await Promise.all([
      classifyPage(page),
      captureFingerprint(page),
    ]);
    console.log(`  Page type: ${pageType}, fingerprint: ${fingerprint.hash}`);
  } catch {
    console.warn(`  Could not classify page for "${area.name}"`);
  }

  const {
    findings,
    screenshots,
    evidence,
    coverageTracker,
    actionRecorder,
    agent,
  } = initWorker(stagehand, {
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
    observedApiEndpoints,
    mission,
    history,
  });

  try {
    const result = await agent.execute({
      instruction: `Explore the "${area.name}" area of this application. Interact with all visible elements, test forms, check edge cases, and report any issues you find using the log_finding tool. Take screenshots before logging findings and include the evidenceId. Use mark_control_exercised after each interaction to track coverage.`,
      maxSteps: stepsPerArea,
    });

    const stepCount =
      "actions" in result && Array.isArray(result.actions)
        ? result.actions.length
        : 0;

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
      status: "explored" as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Worker failed for area "${area.name}": ${message}`);

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
      status: "failed",
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
  agentMode: "cua" | "dom" = "cua",
  screenshotsEnabled = true,
  stagnationThreshold = 0,
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] },
  repoHints?: RepoHints,
  observedApiEndpoints?: ObservedApiEndpoint[],
  mission?: MissionConfig,
  history?: WorkerHistoryContext
): Promise<WorkerResult> {
  const {
    findings,
    evidence,
    coverageTracker,
    followupRequests,
    discoveredEdges,
    actionRecorder,
    agent,
  } = initWorker(stagehand, {
    screenshotDir,
    areaName: task.nodeId,
    appDescription: task.missionContext ?? "",
    objectiveLabel: task.objective,
    pageType: task.pageType,
    agentMode,
    model,
    screenshotsEnabled,
    stagnationThreshold,
    appContext,
    repoHints,
    observedApiEndpoints,
    mission,
    history,
    stateId: task.nodeId,
  });

  try {
    await agent.execute({
      instruction: task.objective,
      maxSteps: task.maxSteps,
    });

    return {
      taskId: task.id,
      findings,
      evidence,
      replayableActions: actionRecorder.getActions(),
      coverageSnapshot: coverageTracker.snapshot(),
      followupRequests,
      discoveredEdges,
      outcome: "completed",
      summary: `Completed ${task.workerType} task: ${task.objective}`,
    };
  } catch (error) {
    return {
      taskId: task.id,
      findings,
      evidence,
      replayableActions: actionRecorder.getActions(),
      coverageSnapshot: coverageTracker.snapshot(),
      followupRequests,
      discoveredEdges,
      outcome: "failed",
      summary: error instanceof Error ? error.message : String(error),
    };
  } finally {
    actionRecorder.stop();
  }
}
