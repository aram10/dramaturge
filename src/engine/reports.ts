// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineContext } from './context.js';
import type { AreaResult, FrontierItem, RunResult } from '../types.js';
import { buildRunResult } from '../report/collector.js';
import { renderMarkdown } from '../report/markdown.js';
import { renderJson } from '../report/json.js';
import { renderJunit } from '../report/junit.js';
import { renderSarif } from '../report/sarif.js';
import { writeGeneratedPlaywrightTests } from '../report/test-gen.js';
import { resolveOutputFormats } from '../config.js';
import { hasLLMApiKey } from '../llm.js';
import type { DiffSummary } from '../types.js';

export function buildAreaResults(ctx: EngineContext): AreaResult[] {
  const results: AreaResult[] = [];
  for (const node of ctx.graph.getAllNodes()) {
    const findings = ctx.findingsByNode.get(node.id) ?? [];
    const evidence = ctx.evidenceByNode.get(node.id) ?? [];
    const replayableActions = ctx.actionsByNode.get(node.id) ?? [];
    if (
      findings.length === 0 &&
      evidence.length === 0 &&
      replayableActions.length === 0 &&
      node.timesVisited === 0
    ) {
      continue;
    }

    results.push({
      name: node.title ?? `${node.pageType} (${node.id})`,
      url: node.url,
      steps: node.timesVisited,
      findings,
      replayableActions,
      screenshots: new Map<string, Buffer>(),
      evidence,
      coverage: {
        controlsDiscovered: node.controlsDiscovered.length,
        controlsExercised: node.controlsExercised.length,
        events: [],
      },
      pageType: node.pageType,
      fingerprint: node.fingerprint,
      status: node.timesVisited > 0 ? 'explored' : 'skipped',
    });
  }
  return results;
}

export function writeReports(
  ctx: EngineContext,
  startTime: Date,
  areaResults: AreaResult[],
  remaining: FrontierItem[]
): void {
  const config = ctx.config;
  const blindSpots = ctx.globalCoverage.getBlindSpots();
  const stateGraphMermaid = ctx.graph.nodeCount() > 0 ? ctx.graph.toMermaid() : undefined;

  const diffSummary: DiffSummary | undefined = ctx.diffContext
    ? {
        baseRef: ctx.diffContext.baseRef,
        changedFileCount: ctx.diffContext.changedFiles.length,
        affectedRoutes: ctx.diffContext.affectedRoutes,
        affectedRouteFamilies: ctx.diffContext.affectedRouteFamilies,
        affectedApiEndpoints: ctx.diffContext.affectedApiEndpoints,
      }
    : undefined;

  const runResult = buildRunResult(
    config.targetUrl,
    startTime,
    areaResults,
    remaining.map((r) => ({
      name: r.objective,
      reason: `Not reached (priority: ${r.priority.toFixed(2)})`,
    })),
    remaining.length > 0,
    {
      blindSpots,
      stateGraphMermaid,
      runConfig: {
        appDescription: config.appDescription,
        models: { planner: config.models.planner, worker: config.models.worker },
        concurrency: config.concurrency.workers,
        budget: {
          timeLimitSeconds: ctx.budget.globalTimeLimitSeconds,
          maxStepsPerTask: ctx.budget.maxStepsPerTask,
          maxStateNodes: ctx.budget.maxStateNodes,
        },
        checkpointInterval: config.checkpoint.intervalTasks,
        autoCaptureEnabled:
          config.autoCapture.consoleErrors ||
          config.autoCapture.consoleWarnings ||
          config.autoCapture.networkErrors,
        llmPlannerEnabled: hasLLMApiKey(config.models.planner),
        memoryEnabled: config.memory.enabled,
        visualRegressionEnabled: config.visualRegression.enabled,
        warmStartEnabled: config.memory.enabled && config.memory.warmStart,
      },
      runMemory: ctx.runMemory,
      diffSummary,
      crossRunClassification: ctx.crossRunClassification,
    }
  );
  const generatedTests = writeGeneratedPlaywrightTests(ctx.outputDir, runResult);

  const formats = resolveOutputFormats(config.output.format);
  let firstFormatLogged = false;
  for (const format of formats) {
    const { filename, content, label } = renderForFormat(format, runResult);
    const outPath = join(ctx.outputDir, filename);
    writeFileSync(outPath, content, 'utf-8');
    ctx.logger?.info('Wrote report artifact', {
      format: label,
      path: outPath,
      firstFormat: !firstFormatLogged,
    });
    firstFormatLogged = true;
  }
  if (generatedTests.length > 0) {
    ctx.logger?.info('Generated Playwright tests', {
      count: generatedTests.length,
      path: join(ctx.outputDir, 'generated-tests'),
    });
  }
}

function renderForFormat(
  format: 'markdown' | 'json' | 'junit' | 'sarif',
  runResult: RunResult
): { filename: string; content: string; label: string } {
  switch (format) {
    case 'markdown':
      return { filename: 'report.md', content: renderMarkdown(runResult), label: 'Markdown' };
    case 'json':
      return { filename: 'report.json', content: renderJson(runResult), label: 'JSON' };
    case 'junit':
      return { filename: 'report.junit.xml', content: renderJunit(runResult), label: 'JUnit' };
    case 'sarif':
      return { filename: 'report.sarif', content: renderSarif(runResult), label: 'SARIF' };
  }
}
