import type { Stagehand } from "@browserbasehq/stagehand";
import { resolveAgentMode, resolveWorkerModel } from "../config.js";
import type { FrontierItem, WorkerResult } from "../types.js";
import type { EngineContext } from "./context.js";
import { executeWorkerTask } from "../worker/worker.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface ExecuteFrontierItemDeps {
  ctx: EngineContext;
  stagehand: Stagehand;
  page: StagehandPage;
  item: FrontierItem;
  taskNumber: number;
  pageKey: string;
  logPrefix?: string;
}

export async function executeFrontierItem(
  deps: ExecuteFrontierItemDeps
): Promise<{ item: FrontierItem; result: WorkerResult | null }> {
  const { ctx, stagehand, page, item, taskNumber, logPrefix = "" } = deps;
  const node = ctx.graph.getNode(item.nodeId);

  console.log(
    `${logPrefix}[${taskNumber}] ${item.workerType} task on ${node.pageType} (${node.url ?? node.id}): ${item.objective}`
  );

  const navResult = await ctx.navigator.navigateTo(
    item.nodeId,
    ctx.graph,
    page,
    stagehand,
    ctx.config.targetUrl
  );

  if (!navResult.success) {
    return { item, result: null };
  }

  ctx.planner.recordDispatch(item.nodeId, item.workerType);
  ctx.graph.recordVisit(item.nodeId);

  const model = resolveWorkerModel(ctx.config, item.workerType);
  const result = await executeWorkerTask(
    stagehand,
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
    ctx.config.appContext,
    ctx.repoHints,
    ctx.mission
  );

  return { item, result };
}
