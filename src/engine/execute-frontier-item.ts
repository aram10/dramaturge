import type { Stagehand } from "@browserbasehq/stagehand";
import { resolveAgentMode, resolveWorkerModel } from "../config.js";
import type { Evidence, FrontierItem, RawFinding, WorkerResult } from "../types.js";
import type { EngineContext } from "./context.js";
import { executeApiWorkerTask } from "../api/worker.js";
import { executeWorkerTask } from "../worker/worker.js";
import { runAccessibilityScan } from "../coverage/accessibility.js";
import { runVisualRegressionScan } from "../coverage/visual-regression.js";
import { buildApiContractArtifacts } from "../api/contract-oracle.js";
import { summarizeContractIndex } from "../spec/contract-index.js";

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
  const { ctx, stagehand, page, item, taskNumber, pageKey, logPrefix = "" } = deps;
  const node = ctx.graph.getNode(item.nodeId);
  const nodeUrl = node.url ?? ctx.config.targetUrl;

  if (ctx.safetyGuard) {
    const blocked = ctx.safetyGuard.checkUrl(nodeUrl);
    if (blocked) {
      console.log(
        `${logPrefix}[${taskNumber}] Blocked by safety guard: ${blocked}`
      );
      return { item, result: null };
    }
  }

  console.log(
    `${logPrefix}[${taskNumber}] ${item.workerType} task on ${node.pageType} (${node.url ?? node.id}): ${item.objective}`
  );

  ctx.trafficObserver?.resetPage(pageKey);
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
  const observedApiEndpoints = ctx.trafficObserver?.snapshot(pageKey) ?? [];

  if (item.workerType === "api") {
    const result = await executeApiWorkerTask({
      taskId: item.id,
      areaName: node.title ?? node.id,
      pageRoute: node.url ?? ctx.config.targetUrl,
      targetUrl: ctx.config.targetUrl,
      observedEndpoints: observedApiEndpoints,
      contractIndex: ctx.contractIndex,
      authenticatedRequestContext: (page as any).request,
      createIsolatedRequestContext: ctx.createIsolatedApiRequestContext,
      config: ctx.config.apiTesting,
    });

    return { item, result };
  }

  const model = resolveWorkerModel(ctx.config, item.workerType);
  const history = ctx.memoryStore?.getWorkerContext(node);
  const preflightFindings: RawFinding[] = [];
  const preflightEvidence: Evidence[] = [];

  if (typeof (page as any)?.evaluate === "function") {
    const accessibility = await runAccessibilityScan(
      page,
      node.title ?? node.id,
      node.url ?? ctx.config.targetUrl
    );
    preflightFindings.push(...accessibility.findings);
    preflightEvidence.push(...accessibility.evidence);

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
      preflightFindings.push(...visualRegression.findings);
      preflightEvidence.push(...visualRegression.evidence);
    }
  }

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
    ctx.contractIndex ? summarizeContractIndex(ctx.contractIndex) : undefined,
    observedApiEndpoints,
    ctx.mission,
    history,
    ctx.config.adversarial,
    ctx.config.judge
  );

  const apiContract = buildApiContractArtifacts({
    areaName: node.title ?? node.id,
    route: node.url ?? ctx.config.targetUrl,
    observedEndpoints: ctx.trafficObserver?.snapshot(pageKey) ?? [],
    contractIndex: ctx.contractIndex,
  });

  if (preflightFindings.length > 0) {
    result.findings.unshift(...preflightFindings);
  }
  if (preflightEvidence.length > 0) {
    result.evidence.unshift(...preflightEvidence);
  }
  if (apiContract.findings.length > 0) {
    result.findings.push(...apiContract.findings);
    result.evidence.push(...apiContract.evidence);
  }

  return { item, result };
}
