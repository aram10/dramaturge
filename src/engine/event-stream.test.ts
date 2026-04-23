// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, vi } from 'vitest';
import { EngineEventEmitter, emitEngineEvent } from './event-stream.js';
import type {
  RunStartEvent,
  RunEndEvent,
  TaskStartEvent,
  TaskCompleteEvent,
  FindingEvent,
  StateDiscoveredEvent,
  ProgressEvent,
  CheckpointEvent,
  ErrorEvent,
  LogEvent,
} from './event-stream.js';

describe('EngineEventEmitter', () => {
  it('emits and receives run:start events', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('run:start', handler);

    const payload: RunStartEvent = {
      targetUrl: 'https://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      budget: { timeLimitSeconds: 900, maxStepsPerTask: 40 },
      concurrency: 2,
    };
    emitter.emit('run:start', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('emits and receives run:end events', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('run:end', handler);

    const payload: RunEndEvent = {
      timestamp: '2026-01-01T00:10:00Z',
      tasksExecuted: 12,
      totalFindings: 3,
      statesDiscovered: 5,
      blindSpots: 1,
      durationMs: 600_000,
    };
    emitter.emit('run:end', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('emits and receives task lifecycle events', () => {
    const emitter = new EngineEventEmitter();
    const starts: TaskStartEvent[] = [];
    const completes: TaskCompleteEvent[] = [];

    emitter.on('task:start', (evt) => starts.push(evt));
    emitter.on('task:complete', (evt) => completes.push(evt));

    emitter.emit('task:start', {
      taskId: 't1',
      taskNumber: 1,
      nodeId: 'n1',
      workerType: 'navigation',
      objective: 'Explore home page',
    });

    emitter.emit('task:complete', {
      taskId: 't1',
      taskNumber: 1,
      nodeId: 'n1',
      outcome: 'completed',
      findingsCount: 2,
      coverageExercised: 5,
      coverageDiscovered: 10,
    });

    expect(starts).toHaveLength(1);
    expect(starts[0].workerType).toBe('navigation');
    expect(completes).toHaveLength(1);
    expect(completes[0].outcome).toBe('completed');
  });

  it('emits finding events', () => {
    const emitter = new EngineEventEmitter();
    const findings: FindingEvent[] = [];
    emitter.on('finding', (evt) => findings.push(evt));

    emitter.emit('finding', {
      taskId: 't1',
      title: 'Broken link on home page',
      severity: 'Major',
      category: 'Bug',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Major');
  });

  it('emits state:discovered events', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('state:discovered', handler);

    const payload: StateDiscoveredEvent = {
      nodeId: 'node-abc',
      url: 'https://example.com/about',
      pageType: 'detail',
      depth: 1,
      totalStates: 3,
    };
    emitter.emit('state:discovered', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('emits progress events', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('progress', handler);

    const payload: ProgressEvent = {
      tasksExecuted: 5,
      tasksRemaining: 10,
      totalFindings: 2,
      statesDiscovered: 4,
      elapsedMs: 30_000,
      estimatedProgress: 0.33,
    };
    emitter.emit('progress', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('emits checkpoint events', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('checkpoint', handler);

    const payload: CheckpointEvent = {
      tasksExecuted: 10,
      outputDir: '/tmp/output',
    };
    emitter.emit('checkpoint', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('emits run:error events', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('run:error', handler);

    const payload: ErrorEvent = {
      message: 'Browser crashed',
      phase: 'engine',
    };
    emitter.emit('run:error', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('emits log events', () => {
    const emitter = new EngineEventEmitter();
    const logs: LogEvent[] = [];
    emitter.on('log', (evt) => logs.push(evt));

    emitter.emit('log', {
      level: 'info',
      scope: 'engine',
      message: 'Started',
      context: { tasks: 1 },
    });

    expect(logs).toEqual([
      {
        level: 'info',
        scope: 'engine',
        message: 'Started',
        context: { tasks: 1 },
      },
    ]);
  });

  it('supports multiple listeners on the same event', () => {
    const emitter = new EngineEventEmitter();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    emitter.on('finding', handler1);
    emitter.on('finding', handler2);

    emitter.emit('finding', {
      taskId: 't1',
      title: 'Issue',
      severity: 'Minor',
      category: 'UX Concern',
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

describe('emitEngineEvent', () => {
  it('emits the event on the emitter when provided', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('run:start', handler);

    emitEngineEvent(emitter, 'run:start', {
      targetUrl: 'https://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      budget: { timeLimitSeconds: 300, maxStepsPerTask: 20 },
      concurrency: 1,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does nothing when emitter is undefined', () => {
    // Should not throw
    emitEngineEvent(undefined, 'run:start', {
      targetUrl: 'https://example.com',
      timestamp: '2026-01-01T00:00:00Z',
      budget: { timeLimitSeconds: 300, maxStepsPerTask: 20 },
      concurrency: 1,
    });
  });

  it('forwards the correct payload', () => {
    const emitter = new EngineEventEmitter();
    const handler = vi.fn();
    emitter.on('task:complete', handler);

    const payload: TaskCompleteEvent = {
      taskId: 'task-42',
      taskNumber: 42,
      nodeId: 'node-7',
      outcome: 'blocked',
      findingsCount: 0,
      coverageExercised: 0,
      coverageDiscovered: 3,
    };
    emitEngineEvent(emitter, 'task:complete', payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });
});
