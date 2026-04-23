// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import { saveCheckpoint } from '../checkpoint.js';
import { MAX_NAV_RETRIES } from '../constants.js';
import type { FrontierItem, WorkerResult } from '../types.js';
import { executeFrontierItem } from './execute-frontier-item.js';
import type { EngineContext } from './context.js';
import {
  assignPageNodeOwner,
  collectResults,
  expandGraph,
  flushOwnedBrowserErrors,
  maintainFrontier,
  routeFollowups,
} from './graph-ops.js';
import { emitEngineEvent } from './event-stream.js';
import type { WorkerSession } from './worker-pool.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

interface BatchTaskResult {
  item: FrontierItem;
  result: WorkerResult | null;
  pageKey: string;
}

export interface RunPlannerLoopOptions {
  initialTasksExecuted: number;
  useLLMPlanner: boolean;
  checkpointInterval: number;
  startMs: number;
}

export interface RunPlannerLoopResult {
  tasksExecuted: number;
  totalFindingsCount: number;
  finalFrontierSnapshot: FrontierItem[] | undefined;
}

function findRootNode(ctx: EngineContext): { id: string } | undefined {
  return ctx.graph.getAllNodes().find((node) => node.depth === 0);
}

function handleNavFailure(ctx: EngineContext, item: FrontierItem, logPrefix = ''): void {
  ctx.logger?.warn('Navigation failed', {
    ...(logPrefix ? { logPrefix } : {}),
    taskId: item.id,
    objective: item.objective,
  });
  item.retryCount++;
  if (item.retryCount >= MAX_NAV_RETRIES) {
    ctx.globalCoverage.addBlindSpot({
      nodeId: item.nodeId,
      summary: `Unreachable: ${item.objective}`,
      reason: 'state-unreachable',
      severity: 'medium',
    });
  } else {
    ctx.frontier.requeue(item);
  }
}

async function processTaskBatch(
  ctx: EngineContext,
  batchItems: FrontierItem[],
  taskNumberStart: number
): Promise<BatchTaskResult[]> {
  const primaryWorker: WorkerSession = {
    key: 'primary',
    stagehand: ctx.stagehand,
    page: ctx.page,
  };
  const workers = [primaryWorker, ...ctx.workerPool];

  const promises = batchItems.map(async (item, index): Promise<BatchTaskResult> => {
    const worker = workers[index % workers.length];
    const taskNumber = taskNumberStart + index;
    assignPageNodeOwner(ctx, worker.key, item.nodeId);

    emitEngineEvent(ctx.eventStream, 'task:start', {
      taskId: item.id,
      taskNumber,
      nodeId: item.nodeId,
      workerType: item.workerType,
      objective: item.objective,
    });

    const result = await executeFrontierItem({
      ctx,
      stagehand: worker.stagehand,
      page: worker.page as StagehandPage,
      item,
      taskNumber,
      pageKey: worker.key,
    });

    if (!result.result) {
      handleNavFailure(ctx, item, workers.length > 1 ? `[${taskNumber}]` : '');
    }

    return {
      ...result,
      pageKey: worker.key,
    };
  });

  return Promise.all(promises);
}

export async function runPlannerLoop(
  ctx: EngineContext,
  options: RunPlannerLoopOptions
): Promise<RunPlannerLoopResult> {
  const { initialTasksExecuted, useLLMPlanner, checkpointInterval, startMs } = options;
  let tasksExecuted = initialTasksExecuted;
  let tasksSinceCheckpoint = 0;
  let totalFindingsCount = 0;

  while (ctx.frontier.hasItems()) {
    const elapsedMs = Date.now() - startMs;
    if (elapsedMs > ctx.budget.globalTimeLimitSeconds * 1000) {
      ctx.logger?.warn('Time budget exhausted', {
        elapsedMs,
        timeLimitMs: ctx.budget.globalTimeLimitSeconds * 1000,
      });
      break;
    }

    const batchItems: FrontierItem[] = [];
    while (batchItems.length < ctx.config.concurrency.workers && ctx.frontier.hasItems()) {
      const item = ctx.frontier.dequeueHighest();
      if (!item) {
        break;
      }
      if (ctx.completedTaskIds.has(item.id)) {
        item.status = 'completed';
        continue;
      }
      batchItems.push(item);
    }

    if (batchItems.length === 0) {
      break;
    }

    const batchResults = await processTaskBatch(ctx, batchItems, tasksExecuted + 1);
    for (const { item, result, pageKey } of batchResults) {
      flushOwnedBrowserErrors(ctx, pageKey);
      if (!result) {
        continue;
      }

      collectResults(ctx, item.nodeId, result);
      const coverageInfo =
        result.coverageSnapshot.controlsExercised > 0
          ? {
              coverageExercised: result.coverageSnapshot.controlsExercised,
              coverageDiscovered: result.coverageSnapshot.controlsDiscovered,
            }
          : undefined;
      ctx.logger?.info('Completed task', {
        taskId: item.id,
        outcome: result.outcome,
        findings: result.findings.length,
        ...(coverageInfo ?? {}),
      });

      emitEngineEvent(ctx.eventStream, 'task:complete', {
        taskId: item.id,
        taskNumber: tasksExecuted + 1,
        nodeId: item.nodeId,
        outcome: result.outcome,
        findingsCount: result.findings.length,
        coverageExercised: result.coverageSnapshot.controlsExercised,
        coverageDiscovered: result.coverageSnapshot.controlsDiscovered,
      });

      for (const finding of result.findings) {
        emitEngineEvent(ctx.eventStream, 'finding', {
          taskId: item.id,
          title: finding.title,
          severity: finding.severity,
          category: finding.category,
        });
      }

      totalFindingsCount += result.findings.length;

      await expandGraph(ctx, item.nodeId, result, useLLMPlanner);
      routeFollowups(ctx, item.nodeId, result);

      item.status = 'completed';
      ctx.completedTaskIds.add(item.id);
      tasksExecuted++;
      tasksSinceCheckpoint++;
    }

    maintainFrontier(ctx);

    const elapsedSinceStart = Date.now() - startMs;
    const timeBudgetMs = ctx.budget.globalTimeLimitSeconds * 1000;
    emitEngineEvent(ctx.eventStream, 'progress', {
      tasksExecuted,
      tasksRemaining: ctx.frontier.size(),
      totalFindings: totalFindingsCount,
      statesDiscovered: ctx.graph.nodeCount(),
      elapsedMs: elapsedSinceStart,
      estimatedProgress: Math.min(1, elapsedSinceStart / timeBudgetMs),
    });

    if (checkpointInterval > 0 && tasksSinceCheckpoint >= checkpointInterval) {
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
      });
      tasksSinceCheckpoint = 0;
      ctx.logger?.info('Saved checkpoint', {
        tasksExecuted,
        outputDir: ctx.outputDir,
      });
      emitEngineEvent(ctx.eventStream, 'checkpoint', {
        tasksExecuted,
        outputDir: ctx.outputDir,
      });
    }

    try {
      const rootNode = findRootNode(ctx);
      if (rootNode) {
        assignPageNodeOwner(ctx, 'primary', rootNode.id);
      }
      await ctx.page.goto(ctx.config.targetUrl);
    } catch {
      ctx.logger?.warn('Failed to navigate back to root URL', {
        targetUrl: ctx.config.targetUrl,
      });
    }
  }

  if (ctx.graph.nodeCount() > 0) {
    flushOwnedBrowserErrors(ctx, 'primary');
    for (const worker of ctx.workerPool) {
      flushOwnedBrowserErrors(ctx, worker.key);
    }
  }

  return {
    tasksExecuted,
    totalFindingsCount,
    finalFrontierSnapshot: checkpointInterval > 0 ? ctx.frontier.snapshot() : undefined,
  };
}
