// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import { resolveAgentMode, resolveWorkerModel } from '../config.js';
import type { Evidence, FrontierItem, RawFinding, StateNode, WorkerResult } from '../types.js';
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
import type { ObservedApiEndpoint } from '../network/traffic-observer.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

export interface ExecuteFrontierItemDeps {
  ctx: EngineContext;
  stagehand: Stagehand;
  page: StagehandPage;
  item: FrontierItem;
  taskNumber: number;
  pageKey: string;
  taskTimeoutMs?: number;
  logPrefix?: string;
  /** A2A task ID when multi-agent mode is enabled. */
  a2aTaskId?: string;
}

interface PreflightScanResult {
  preflightFindings: RawFinding[];
  preflightEvidence: Evidence[];
  visionContext: string | undefined;
}

interface PreflightData {
  preflightFindings: RawFinding[];
  preflightEvidence: Evidence[];
}

interface ApiWorkerPathDeps {
  ctx: EngineContext;
  page: StagehandPage;
  item: FrontierItem;
  node: StateNode;
  observedApiEndpoints: ObservedApiEndpoint[];
}

interface MainWorkerTaskDeps {
  ctx: EngineContext;
  stagehand: Stagehand;
  item: FrontierItem;
  node: StateNode;
  observedApiEndpoints: ObservedApiEndpoint[];
  taskTimeoutMs: number | undefined;
  a2aContext: ExecuteWorkerTaskOptions['a2aContext'];
}

function resolveA2AContext(
  ctx: EngineContext,
  item: FrontierItem,
  a2aTaskId: string | undefined
): ExecuteWorkerTaskOptions['a2aContext'] {
  if (ctx.coordinator && ctx.blackboard && a2aTaskId) {
    const agentRole = ctx.coordinator.resolveAgentRole(item.workerType);
    const agentCard = ctx.coordinator.getAgent(agentRole);
    if (agentCard) {
      return {
        agentRole,
        agentId: agentCard.id,
        blackboard: ctx.blackboard,
        blackboardSummary: ctx.blackboard.summarize(10),
      };
    }
  }
  return undefined;
}

async function runApiWorkerPath(deps: ApiWorkerPathDeps): Promise<WorkerResult> {
  const { ctx, page, item, node, observedApiEndpoints } = deps;
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
  return result;
}

async function runPreflightScans(
  page: StagehandPage,
  ctx: EngineContext,
  node: StateNode
): Promise<PreflightScanResult> {
  const preflightFindings: RawFinding[] = [];
  const preflightEvidence: Evidence[] = [];
  let visionContext: string | undefined;
  const areaName = node.title ?? node.id;
  const route = node.url ?? ctx.config.targetUrl;

  if (hasEvaluate(page)) {
    const accessibility = await runAccessibilityScan(page, areaName, route);
    preflightFindings.push(...accessibility.findings);
    preflightEvidence.push(...accessibility.evidence);

    if (ctx.config.visualRegression.enabled) {
      const visualRegression = await runVisualRegressionScan(page, {
        areaName,
        route,
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
        route,
        areaName,
        ctx.config.webVitals.thresholds
      );
      preflightFindings.push(...webVitalsResult.findings);
      preflightEvidence.push(...webVitalsResult.evidence);
    }

    // Responsive regression requires visual regression infrastructure (baselines, pixel diff)
    if (ctx.config.responsiveRegression.enabled && ctx.config.visualRegression.enabled) {
      const responsive = await runMultiViewportVisualRegression(page, {
        areaName,
        route,
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

  if (ctx.config.visionAnalysis.enabled && hasScreenshot(page)) {
    try {
      const visionResult = await analyzeScreenshot(page, {
        areaName,
        route,
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
        areaName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { preflightFindings, preflightEvidence, visionContext };
}

function mergePreflightResults(
  result: WorkerResult,
  preflightFindings: RawFinding[],
  preflightEvidence: Evidence[]
): void {
  if (preflightFindings.length > 0) {
    result.findings.unshift(...preflightFindings);
  }
  if (preflightEvidence.length > 0) {
    result.evidence.unshift(...preflightEvidence);
  }
}

async function runMainWorkerTask(
  deps: MainWorkerTaskDeps,
  preflightData: PreflightData,
  visionContext: string | undefined
): Promise<WorkerResult> {
  const { ctx, stagehand, item, node, observedApiEndpoints, taskTimeoutMs, a2aContext } = deps;
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
    {
      model,
      screenshotDir: ctx.screenshotDir,
      timeoutMs: taskTimeoutMs,
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

  mergePreflightResults(result, preflightData.preflightFindings, preflightData.preflightEvidence);
  return result;
}

interface ApiContractDeps {
  ctx: EngineContext;
  result: WorkerResult;
  apiContract: { findings: RawFinding[]; evidence: Evidence[] };
  observedApiEndpoints: ObservedApiEndpoint[];
  areaName: string;
  stateId: string;
  taskId: string;
}

function appendApiContractResults(deps: ApiContractDeps): void {
  const { ctx, result, apiContract, observedApiEndpoints, areaName, stateId, taskId } = deps;
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
      context: { areaName, stateId, taskId },
    });
    ctx.runLedger = appendToLedger(ctx.runLedger, contractLedger);
  }
}

export async function executeFrontierItem(
  deps: ExecuteFrontierItemDeps
): Promise<{ item: FrontierItem; result: WorkerResult | null }> {
  const {
    ctx,
    stagehand,
    page,
    item,
    taskNumber,
    pageKey,
    taskTimeoutMs,
    logPrefix = '',
    a2aTaskId,
  } = deps;
  const node = ctx.graph.getNode(item.nodeId);
  const nodeUrl = node.url ?? ctx.config.targetUrl;
  const areaName = node.title ?? node.id;
  const a2aContext = resolveA2AContext(ctx, item, a2aTaskId);
  const logContext = logPrefix ? { logPrefix } : {};

  if (ctx.safetyGuard) {
    const blocked = ctx.safetyGuard.checkUrl(nodeUrl);
    if (blocked) {
      ctx.logger?.warn('Blocked by safety guard', {
        ...logContext,
        taskNumber,
        nodeUrl,
        reason: blocked,
      });
      return { item, result: null };
    }
  }

  ctx.logger?.info('Dispatching task', {
    ...logContext,
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
    const result = await runApiWorkerPath({ ctx, page, item, node, observedApiEndpoints });
    return { item, result };
  }

  const { preflightFindings, preflightEvidence, visionContext } = await runPreflightScans(
    page,
    ctx,
    node
  );

  const result = await runMainWorkerTask(
    { ctx, stagehand, item, node, observedApiEndpoints, taskTimeoutMs, a2aContext },
    { preflightFindings, preflightEvidence },
    visionContext
  );

  if (result.explorationLedger) {
    ctx.runLedger = appendToLedger(ctx.runLedger, result.explorationLedger);
  }

  const apiContract = buildApiContractArtifacts({
    areaName,
    route: nodeUrl,
    observedEndpoints: ctx.trafficObserver?.snapshot(pageKey) ?? [],
    contractIndex: ctx.contractIndex,
  });

  appendApiContractResults({
    ctx,
    result,
    apiContract,
    observedApiEndpoints,
    areaName,
    stateId: node.id,
    taskId: item.id,
  });

  return { item, result };
}
