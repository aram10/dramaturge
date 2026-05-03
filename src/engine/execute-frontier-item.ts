// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import { resolveAgentMode, resolveWorkerModel } from '../config.js';
import type { Evidence, FrontierItem, RawFinding, WorkerResult } from '../types.js';
import { hasEvaluate, hasRequestContext, hasScreenshot } from '../browser/page-interface.js';
import type { EngineContext } from './context.js';
import { executeApiWorkerTask } from '../api/worker.js';
import { executeWorkerTask, type ExecuteWorkerTaskOptions } from '../worker/worker.js';
import { runAccessibilityScan } from '../coverage/accessibility.js';
import { runVisualRegressionScan } from '../coverage/visual-regression.js';
import { collectWebVitals, evaluateWebVitals } from '../coverage/web-vitals.js';
import { runMultiViewportVisualRegression } from '../coverage/responsive-regression.js';
import { analyzeScreenshot } from '../coverage/vision-analysis.js';
import { buildApiContractArtifacts } from '../api/contract-oracle.js';
import { summarizeContractIndex } from '../spec/contract-index.js';
import { appendToLedger, mergeLedgerEntries } from '../ledger.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

export interface ExecuteFrontierItemDeps {
  ctx: EngineContext;
  stagehand: Stagehand;
  page: StagehandPage;
  item: FrontierItem;
  taskNumber: number;
  pageKey: string;
  logPrefix?: string;
  /** A2A task ID when multi-agent mode is enabled. */
  a2aTaskId?: string;
}

export async function executeFrontierItem(
  deps: ExecuteFrontierItemDeps
): Promise<{ item: FrontierItem; result: WorkerResult | null }> {
  const { ctx, stagehand, page, item, taskNumber, pageKey, logPrefix = '', a2aTaskId } = deps;
  const node = ctx.graph.getNode(item.nodeId);
  const nodeUrl = node.url ?? ctx.config.targetUrl;

  // A2A: Resolve agent role and prepare context
  let a2aContext: ExecuteWorkerTaskOptions['a2aContext'];
  if (ctx.coordinator && ctx.blackboard && a2aTaskId) {
    const agentRole = ctx.coordinator.resolveAgentRole(item.workerType);
    const agentCard = ctx.coordinator.getAgent(agentRole);
    if (agentCard) {
      a2aContext = {
        agentRole,
        agentId: agentCard.id,
        blackboard: ctx.blackboard,
        blackboardSummary: ctx.blackboard.summarize(10),
      };
    }
  }

  if (ctx.safetyGuard) {
    const blocked = ctx.safetyGuard.checkUrl(nodeUrl);
    if (blocked) {
      ctx.logger?.warn('Blocked by safety guard', {
        ...(logPrefix ? { logPrefix } : {}),
        taskNumber,
        nodeUrl,
        reason: blocked,
      });
      return { item, result: null };
    }
  }

  ctx.logger?.info('Dispatching task', {
    ...(logPrefix ? { logPrefix } : {}),
    taskNumber,
    taskId: item.id,
    workerType: item.workerType,
    pageType: node.pageType,
    node: node.url ?? node.id,
    objective: item.objective,
  });

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

  if (item.workerType === 'api') {
    if (!hasRequestContext(page)) {
      throw new Error('Browser page does not expose an authenticated request context.');
    }
    const result = await executeApiWorkerTask({
      taskId: item.id,
      areaName: node.title ?? node.id,
      pageRoute: node.url ?? ctx.config.targetUrl,
      targetUrl: ctx.config.targetUrl,
      observedEndpoints: observedApiEndpoints,
      contractIndex: ctx.contractIndex,
      authenticatedRequestContext: page.request,
      createIsolatedRequestContext: ctx.createIsolatedApiRequestContext,
      config: ctx.config.apiTesting,
    });

    const allCostRecords = ctx.costTracker?.getRecords() ?? [];
    const newCostRecords = allCostRecords.slice(ctx.costLedgerCursor);
    ctx.costLedgerCursor = allCostRecords.length;
    const apiLedger = mergeLedgerEntries({
      actionRecorderActions: [],
      evidence: result.evidence,
      findings: result.findings,
      observedApiEndpoints,
      costRecords: newCostRecords,
      context: { areaName: node.title ?? node.id, stateId: node.id, taskId: item.id },
    });
    ctx.runLedger = appendToLedger(ctx.runLedger, apiLedger);

    return { item, result };
  }

  const model = resolveWorkerModel(ctx.config, item.workerType);
  const history = ctx.memoryStore?.getWorkerContext(node);
  const preflightFindings: RawFinding[] = [];
  const preflightEvidence: Evidence[] = [];

  if (hasEvaluate(page)) {
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

    if (ctx.config.webVitals.enabled) {
      const vitals = await collectWebVitals(page);
      const webVitalsResult = evaluateWebVitals(
        vitals,
        node.url ?? ctx.config.targetUrl,
        node.title ?? node.id,
        ctx.config.webVitals.thresholds
      );
      preflightFindings.push(...webVitalsResult.findings);
      preflightEvidence.push(...webVitalsResult.evidence);
    }

    // Responsive regression requires visual regression infrastructure (baselines, pixel diff)
    if (ctx.config.responsiveRegression.enabled && ctx.config.visualRegression.enabled) {
      const responsive = await runMultiViewportVisualRegression(page, {
        areaName: node.title ?? node.id,
        route: node.url ?? ctx.config.targetUrl,
        fingerprintHash: node.fingerprint.hash,
        baselineDir: ctx.config.visualRegression.baselineDir,
        outputDir: ctx.outputDir,
        diffPixelRatioThreshold: ctx.config.visualRegression.diffPixelRatioThreshold,
        includeAA: ctx.config.visualRegression.includeAA,
        fullPage: ctx.config.visualRegression.fullPage,
        maskSelectors: ctx.config.visualRegression.maskSelectors,
        breakpoints: ctx.config.responsiveRegression.breakpoints,
        memoryStore: ctx.memoryStore,
      });
      preflightFindings.push(...responsive.findings);
      preflightEvidence.push(...responsive.evidence);
    }
  }

  let visionContext: string | undefined;
  if (ctx.config.visionAnalysis.enabled && hasScreenshot(page)) {
    try {
      const visionResult = await analyzeScreenshot(page, {
        areaName: node.title ?? node.id,
        route: node.url ?? ctx.config.targetUrl,
        pageType: node.pageType,
        model: ctx.config.visionAnalysis.model,
        fullPage: ctx.config.visionAnalysis.fullPage,
        maxResponseTokens: ctx.config.visionAnalysis.maxResponseTokens,
        requestTimeoutMs: ctx.config.visionAnalysis.requestTimeoutMs,
      });
      preflightFindings.push(...visionResult.findings);
      preflightEvidence.push(...visionResult.evidence);
      if (visionResult.pageDescription) {
        visionContext = visionResult.pageDescription;
      }
    } catch (err) {
      ctx.logger?.warn('Vision analysis failed', {
        areaName: node.title ?? node.id,
        error: err instanceof Error ? err.message : String(err),
      });
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
    {
      model,
      screenshotDir: ctx.screenshotDir,
      agentMode: resolveAgentMode(ctx.config, item.workerType),
      screenshotsEnabled: ctx.config.output.screenshots,
      stagnationThreshold: ctx.config.budget.stagnationThreshold ?? 0,
      appContext: ctx.config.appContext,
      repoHints: ctx.repoHints,
      contractSummary: ctx.contractIndex ? summarizeContractIndex(ctx.contractIndex) : undefined,
      observedApiEndpoints,
      mission: ctx.mission,
      history,
      adversarialConfig: ctx.config.adversarial,
      judgeConfig: ctx.config.judge,
      visionContext,
      safetyGuard: ctx.safetyGuard,
      a2aContext,
    }
  );

  if (result.explorationLedger) {
    ctx.runLedger = appendToLedger(ctx.runLedger, result.explorationLedger);
  }

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

  if (apiContract.findings.length > 0 || apiContract.evidence.length > 0) {
    const allCostRecords = ctx.costTracker?.getRecords() ?? [];
    const newCostRecords = allCostRecords.slice(ctx.costLedgerCursor);
    ctx.costLedgerCursor = allCostRecords.length;
    const contractLedger = mergeLedgerEntries({
      actionRecorderActions: [],
      evidence: apiContract.evidence,
      findings: apiContract.findings,
      observedApiEndpoints,
      costRecords: newCostRecords,
      context: { areaName: node.title ?? node.id, stateId: node.id, taskId: item.id },
    });
    ctx.runLedger = appendToLedger(ctx.runLedger, contractLedger);
  }

  return { item, result };
}
