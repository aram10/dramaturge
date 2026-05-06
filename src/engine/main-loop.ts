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

function createEmptyCoverageSnapshot(): WorkerResult['coverageSnapshot'] {
  return {
    controlsDiscovered: 0,
    controlsExercised: 0,
    events: [],
  };
}

function normalizeBatchError(taskId: string, error: unknown): WorkerResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    taskId,
    findings: [],
    evidence: [],
    coverageSnapshot: createEmptyCoverageSnapshot(),
    followupRequests: [],
    discoveredEdges: [],
    outcome: 'failed',
    summary: message,
  };
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

const MIN_DERIVED_TASK_TIMEOUT_MS = 5_000;
const MAX_DERIVED_TASK_TIMEOUT_MS = 5 * 60_000;
const DERIVED_TASK_TIMEOUT_FRACTION = 0.25;

function resolveTaskTimeoutMs(ctx: EngineContext, startMs: number): number {
  const remainingMs = ctx.budget.globalTimeLimitSeconds * 1000 - (Date.now() - startMs);
  if (remainingMs <= 0) {
    return 1;
  }

  const configuredSeconds = ctx.budget.taskTimeLimitSeconds;
  if (configuredSeconds !== undefined) {
    return Math.max(1, Math.min(remainingMs, configuredSeconds * 1000));
  }

  const derived = Math.floor(remainingMs * DERIVED_TASK_TIMEOUT_FRACTION);
  const bounded = Math.min(
    MAX_DERIVED_TASK_TIMEOUT_MS,
    Math.max(MIN_DERIVED_TASK_TIMEOUT_MS, derived)
  );
  return Math.max(1, Math.min(remainingMs, bounded));
}

async function processTaskBatch(
  ctx: EngineContext,
  batchItems: FrontierItem[],
  taskNumberStart: number,
  startMs: number
): Promise<BatchTaskResult[]> {
  const primaryWorker: WorkerSession = {
    key: 'primary',
    stagehand: ctx.stagehand,
    page: ctx.page,
  };
  const workers = [primaryWorker, ...ctx.workerPool];
  const a2aTaskIds = new Array<string | undefined>(batchItems.length);

  const promises = batchItems.map(async (item, index): Promise<BatchTaskResult> => {
    const worker = workers[index % workers.length];
    const taskNumber = taskNumberStart + index;
    assignPageNodeOwner(ctx, worker.key, item.nodeId);

    // A2A: Assign task to coordinator and update status to 'working'
    let a2aTaskId: string | undefined;
    if (ctx.coordinator) {
      const a2aTask = ctx.coordinator.assignTask(item);
      a2aTaskId = a2aTask.id;
      ctx.coordinator.updateTaskStatus(a2aTaskId, 'working');
    }
    a2aTaskIds[index] = a2aTaskId;

    emitEngineEvent(ctx.eventStream, 'task:start', {
      taskId: item.id,
      taskNumber,
      nodeId: item.nodeId,
      workerType: item.workerType,
      objective: item.objective,
    });

    const taskTimeoutMs = resolveTaskTimeoutMs(ctx, startMs);
    const result = await executeFrontierItem({
      ctx,
      stagehand: worker.stagehand,
      page: worker.page as StagehandPage,
      item,
      taskNumber,
      pageKey: worker.key,
      taskTimeoutMs,
      a2aTaskId,
    });

    if (!result.result) {
      handleNavFailure(ctx, item, workers.length > 1 ? `[${taskNumber}]` : '');
      // A2A: Mark task as failed
      if (a2aTaskId && ctx.coordinator) {
        ctx.coordinator.updateTaskStatus(a2aTaskId, 'failed');
      }
    } else if (a2aTaskId && ctx.coordinator) {
      // A2A: Update task status based on actual worker outcome
      const outcome = result.result.outcome;
      if (outcome === 'completed') {
        const findingsCount = result.result.findings?.length ?? 0;
        const summary = `${item.workerType} task on ${item.objective}`;
        ctx.coordinator.completeTask(a2aTaskId, summary, findingsCount);
      } else {
        // 'failed', 'blocked', and 'timed-out' all map to A2A 'failed' status
        ctx.coordinator.updateTaskStatus(a2aTaskId, 'failed');
      }
    }

    return {
      ...result,
      pageKey: worker.key,
    };
  });

  const settled = await Promise.allSettled(promises);
  return settled.map((entry, index): BatchTaskResult => {
    if (entry.status === 'fulfilled') {
      return entry.value;
    }

    const item = batchItems[index];
    const worker = workers[index % workers.length];
    const a2aTaskId = a2aTaskIds[index];
    if (a2aTaskId && ctx.coordinator) {
      ctx.coordinator.updateTaskStatus(a2aTaskId, 'failed');
    }

    return {
      item,
      result: normalizeBatchError(item.id, entry.reason),
      pageKey: worker.key,
    };
  });
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

    const batchResults = await processTaskBatch(ctx, batchItems, tasksExecuted + 1, startMs);
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
        explorationLedger: ctx.runLedger,
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
