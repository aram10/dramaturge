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
} from "../types.js";
import { CoverageTracker } from "../coverage/tracker.js";
import { captureFingerprint } from "../graph/fingerprint.js";
import { classifyPage } from "../planner/page-classifier.js";

export async function exploreArea(
  stagehand: Stagehand,
  area: Area,
  appDescription: string,
  model: string,
  stepsPerArea: number,
  screenshotDir: string
): Promise<AreaResult> {
  const findings: RawFinding[] = [];
  const screenshots = new Map<string, Buffer>();
  const evidence: Evidence[] = [];
  const coverageTracker = new CoverageTracker();
  const page = stagehand.context.pages()[0];

  // Classify the page and capture fingerprint before starting the worker
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

  const tools = createWorkerTools(
    findings,
    screenshots,
    evidence,
    coverageTracker,
    page,
    screenshotDir,
    area.name
  );

  const systemPrompt = buildWorkerSystemPrompt(
    appDescription,
    area.name,
    area.description,
    pageType
  );

  // Cast tools to any to work around Zod v3/v4 type mismatch in Stagehand's .d.ts.
  // At runtime the tool objects have the correct shape (description, inputSchema, execute).
  const agent = stagehand.agent({
    mode: "cua",
    model,
    systemPrompt,
    tools: tools as any,
  });

  try {
    const result = await agent.execute({
      instruction: `Explore the "${area.name}" area of this application. Interact with all visible elements, test forms, check edge cases, and report any issues you find using the log_finding tool. Take screenshots before logging findings and include the evidenceId. Use mark_control_exercised after each interaction to track coverage.`,
      maxSteps: stepsPerArea,
    });

    // AgentResult.actions may not exist on all return types; access safely
    const stepCount =
      "actions" in result && Array.isArray(result.actions)
        ? result.actions.length
        : 0;

    return {
      name: area.name,
      url: area.url,
      steps: stepCount,
      findings,
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
      screenshots,
      evidence,
      coverage: coverageTracker.snapshot(),
      pageType,
      fingerprint,
      status: "failed",
      failureReason: message,
    };
  }
}

/**
 * V2 engine-compatible entry point: accepts a WorkerTask, returns a WorkerResult.
 */
export async function executeWorkerTask(
  stagehand: Stagehand,
  task: WorkerTask,
  model: string,
  screenshotDir: string
): Promise<WorkerResult> {
  const findings: RawFinding[] = [];
  const screenshots = new Map<string, Buffer>();
  const evidence: Evidence[] = [];
  const coverageTracker = new CoverageTracker();
  const followupRequests: FollowupRequest[] = [];
  const discoveredEdges: DiscoveredEdge[] = [];
  const page = stagehand.context.pages()[0];

  const tools = createWorkerTools(
    findings,
    screenshots,
    evidence,
    coverageTracker,
    page,
    screenshotDir,
    task.nodeId,
    followupRequests,
    discoveredEdges
  );

  const systemPrompt = buildWorkerSystemPrompt(
    task.missionContext ?? "",
    task.objective,
    undefined,
    task.pageType
  );

  const agent = stagehand.agent({
    mode: "cua",
    model,
    systemPrompt,
    tools: tools as any,
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
      coverageSnapshot: coverageTracker.snapshot(),
      followupRequests,
      discoveredEdges,
      outcome: "failed",
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}
