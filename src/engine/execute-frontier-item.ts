import type { Stagehand } from "@browserbasehq/stagehand";
import { resolveAgentMode, resolveWorkerModel } from "../config.js";
import type { FrontierItem, WorkerResult } from "../types.js";
import type { EngineContext } from "./context.js";
import { executeWorkerTask } from "../worker/worker.js";
import { runAccessibilityScan } from "../coverage/accessibility.js";
import { runVisualRegressionScan } from "../coverage/visual-regression.js";

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
  const history = ctx.memoryStore?.getWorkerContext(node);
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
    ctx.trafficObserver?.snapshot(),
    ctx.mission,
    history
  );

  if (typeof (page as any)?.evaluate === "function") {
    const accessibility = await runAccessibilityScan(
      page,
      node.title ?? node.id,
      node.url ?? ctx.config.targetUrl
    );
    if (accessibility.findings.length > 0) {
      result.findings.push(...accessibility.findings);
      result.evidence.push(...accessibility.evidence);
    }

    if (ctx.config.visualRegression.enabled) {
      const visualRegression = await runVisualRegressionScan(page, {
        areaName: node.title ?? node.id,
        route: node.url ?? ctx.config.targetUrl,
        fingerprintHash: node.fingerprint.hash,
        baselineDir: ctx.config.visualRegression.baselineDir,
        outputDir: ctx.outputDir,
        diffPixelRatioThreshold: ctx.config.visualRegression.diffPixelRatioThreshold,
        includeAA: ctx.config.visualRegression.includeAA,
        fullPage: ctx.config.visualRegression.fullPage,
        maskSelectors: ctx.config.visualRegression.maskSelectors,
        memoryStore: ctx.memoryStore,
      });
      if (visualRegression.findings.length > 0) {
        result.findings.push(...visualRegression.findings);
        result.evidence.push(...visualRegression.evidence);
      }
    }
  }

  return { item, result };
}
