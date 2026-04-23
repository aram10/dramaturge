// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { saveCheckpoint } from '../checkpoint.js';
import { collectFindings } from '../report/collector.js';
import { classifyFindings } from '../report/cross-run-classification.js';
import type { FrontierItem } from '../types.js';
import type { EngineContext } from './context.js';
import { emitEngineEvent } from './event-stream.js';
import { buildAreaResults, writeReports } from './reports.js';

export interface FinalizeRunOptions {
  startTime: Date;
  tasksExecuted: number;
  warmStartApplied: boolean;
  warmStartRestoredStateCount: number;
  checkpointInterval: number;
  finalFrontierSnapshot?: FrontierItem[];
}

function recordRemainingBlindSpots(ctx: EngineContext, remaining: FrontierItem[]): void {
  for (const item of remaining) {
    ctx.globalCoverage.addBlindSpot({
      nodeId: item.nodeId,
      summary: `Not reached: ${item.objective}`,
      reason: 'time-budget',
      severity: item.priority > 0.7 ? 'high' : 'low',
    });
  }
}

export function finalizeRun(ctx: EngineContext, options: FinalizeRunOptions): void {
  const {
    startTime,
    tasksExecuted,
    warmStartApplied,
    warmStartRestoredStateCount,
    checkpointInterval,
    finalFrontierSnapshot,
  } = options;

  const remaining = ctx.frontier.drain();
  recordRemainingBlindSpots(ctx, remaining);

  if (checkpointInterval > 0) {
    saveCheckpoint({
      outputDir: ctx.outputDir,
      graph: ctx.graph,
      frontier: ctx.frontier,
      findingsByNode: ctx.findingsByNode,
      evidenceByNode: ctx.evidenceByNode,
      actionsByNode: ctx.actionsByNode,
      coverage: ctx.globalCoverage,
      completedTaskIds: [...ctx.completedTaskIds],
      tasksExecuted,
      plannerState: ctx.planner.snapshotDispatchState(),
      options: {
        frontierSnapshot: finalFrontierSnapshot,
      },
    });
  }

  const areaResults = buildAreaResults(ctx);
  if (ctx.memoryStore) {
    const preRunSnapshot = ctx.memoryStore.getSnapshot();
    const findings = collectFindings(areaResults);
    const includeResolved = remaining.length === 0;
    ctx.crossRunClassification = classifyFindings(
      findings,
      preRunSnapshot.findingHistory,
      preRunSnapshot.flakyPages,
      { includeResolved }
    );

    ctx.memoryStore.recordRunFindings(startTime.toISOString(), areaResults);
    ctx.memoryStore.recordObservedApiTraffic(
      startTime.toISOString(),
      ctx.trafficObserver?.snapshot() ?? []
    );
    ctx.memoryStore.recordNavigationSnapshot(ctx.config.targetUrl, ctx.graph);
    ctx.runMemory = ctx.memoryStore.getSummary(warmStartApplied, warmStartRestoredStateCount);
  }

  writeReports(ctx, startTime, areaResults, remaining);

  const blindSpots = ctx.globalCoverage.getBlindSpots();
  const totalFindings = [...ctx.findingsByNode.values()].reduce(
    (sum, findings) => sum + findings.length,
    0
  );
  ctx.logger.info('Run complete', {
    tasksExecuted,
    totalFindings,
    statesDiscovered: ctx.graph.nodeCount(),
    blindSpots: blindSpots.length,
    durationMs: Date.now() - startTime.getTime(),
  });

  emitEngineEvent(ctx.eventStream, 'run:end', {
    timestamp: new Date().toISOString(),
    tasksExecuted,
    totalFindings,
    statesDiscovered: ctx.graph.nodeCount(),
    blindSpots: blindSpots.length,
    durationMs: Date.now() - startTime.getTime(),
  });
}
