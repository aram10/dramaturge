// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineEventEmitter } from './event-stream.js';
import { runPlannerLoop } from './main-loop.js';
import { executeFrontierItem } from './execute-frontier-item.js';
import {
  collectResults,
  flushOwnedBrowserErrors,
  maintainFrontier,
  routeFollowups,
  expandGraph,
  assignPageNodeOwner,
} from './graph-ops.js';

vi.mock('./execute-frontier-item.js', () => ({
  executeFrontierItem: vi.fn(),
}));

vi.mock('./graph-ops.js', () => ({
  assignPageNodeOwner: vi.fn(),
  collectResults: vi.fn(),
  expandGraph: vi.fn(),
  flushOwnedBrowserErrors: vi.fn(),
  maintainFrontier: vi.fn(),
  routeFollowups: vi.fn(),
}));

describe('runPlannerLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps successful results when one task in the batch throws', async () => {
    const item1 = {
      id: 'task-1',
      nodeId: 'node-1',
      workerType: 'navigation',
      objective: 'Explore home',
      priority: 1,
      reason: 'test',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: 'pending',
    } as const;
    const item2 = {
      id: 'task-2',
      nodeId: 'node-2',
      workerType: 'crud',
      objective: 'Edit record',
      priority: 1,
      reason: 'test',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: 'pending',
    } as const;

    vi.mocked(executeFrontierItem)
      .mockResolvedValueOnce({
        item: item1,
        result: {
          taskId: 'task-1',
          findings: [],
          evidence: [],
          coverageSnapshot: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
          followupRequests: [],
          discoveredEdges: [],
          outcome: 'completed',
          summary: 'ok',
        },
      })
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      });

    const items = [item1, item2];
    const frontier = {
      hasItems: () => items.length > 0,
      dequeueHighest: () => items.shift(),
      requeue: vi.fn(),
      size: () => items.length,
    };

    const completedTaskIds = new Set<string>();
    const eventStream = new EngineEventEmitter();
    const completes: Array<{ taskId: string; outcome: string }> = [];
    eventStream.on('task:complete', (evt) =>
      completes.push({ taskId: evt.taskId, outcome: evt.outcome })
    );

    const ctx = {
      stagehand: {} as any,
      page: {} as any,
      workerPool: [],
      frontier,
      completedTaskIds,
      eventStream,
      config: {
        concurrency: { workers: 2 },
        budget: {},
      },
      budget: {
        globalTimeLimitSeconds: 60,
        maxStepsPerTask: 5,
        maxFrontierSize: 200,
        maxStateNodes: 50,
      },
      graph: {
        nodeCount: () => 0,
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
      globalCoverage: {
        addBlindSpot: vi.fn(),
      },
      findingsByNode: new Map(),
      evidenceByNode: new Map(),
      actionsByNode: new Map(),
    } as any;

    const startMs = Date.now();
    const result = await runPlannerLoop(ctx, {
      initialTasksExecuted: 0,
      useLLMPlanner: false,
      checkpointInterval: 0,
      startMs,
    });

    expect(result.tasksExecuted).toBe(2);
    expect(vi.mocked(assignPageNodeOwner)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(flushOwnedBrowserErrors)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(collectResults)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(expandGraph)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(routeFollowups)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(maintainFrontier)).toHaveBeenCalledTimes(1);
    expect(completes).toEqual(
      expect.arrayContaining([
        { taskId: 'task-1', outcome: 'completed' },
        { taskId: 'task-2', outcome: 'failed' },
      ])
    );
  });
});
