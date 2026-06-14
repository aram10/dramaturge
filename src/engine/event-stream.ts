// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { EventEmitter } from 'node:events';
import type { WorkerResult, FindingSeverity, WorkerType, AgentRole } from '../types.js';
import type { A2ATaskStatus, BlackboardEntryKind } from '../a2a/types.js';

// --- Event payload types ---

export interface RunStartEvent {
  targetUrl: string;
  timestamp: string;
  budget: { timeLimitSeconds: number; maxStepsPerTask: number };
  concurrency: number;
}

export interface RunEndEvent {
  timestamp: string;
  tasksExecuted: number;
  totalFindings: number;
  statesDiscovered: number;
  blindSpots: number;
  durationMs: number;
}

export interface TaskStartEvent {
  taskId: string;
  taskNumber: number;
  nodeId: string;
  workerType: WorkerType;
  objective: string;
}

export interface TaskCompleteEvent {
  taskId: string;
  taskNumber: number;
  nodeId: string;
  outcome: WorkerResult['outcome'];
  findingsCount: number;
  coverageExercised: number;
  coverageDiscovered: number;
}

export interface FindingEvent {
  taskId: string;
  title: string;
  severity: FindingSeverity;
  category: string;
}

export interface StateDiscoveredEvent {
  nodeId: string;
  url?: string;
  pageType: string;
  depth: number;
  totalStates: number;
}

export interface ProgressEvent {
  tasksExecuted: number;
  tasksRemaining: number;
  totalFindings: number;
  statesDiscovered: number;
  elapsedMs: number;
  /** Progress ratio from 0 to 1 (best-effort estimate). */
  estimatedProgress: number;
}

export interface CheckpointEvent {
  tasksExecuted: number;
  outputDir: string;
}

export interface ErrorEvent {
  message: string;
  phase: string;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
}

// --- A2A event payloads ---

/** A coordinator task lifecycle transition, surfaced to the dashboard. */
export interface A2ATaskEvent {
  taskId: string;
  agentId: string;
  agentRole: AgentRole;
  status: A2ATaskStatus;
  objective: string;
}

/** An inter-agent message, surfaced to the dashboard. */
export interface A2AMessageEvent {
  fromAgent: string;
  toAgent: string;
  text: string;
}

/** A blackboard entry, surfaced to the dashboard. */
export interface A2ABlackboardEvent {
  kind: BlackboardEntryKind;
  agentId: string;
  summary: string;
}

// --- Event map ---

export interface EngineEventMap {
  'run:start': [RunStartEvent];
  'run:end': [RunEndEvent];
  'task:start': [TaskStartEvent];
  'task:complete': [TaskCompleteEvent];
  finding: [FindingEvent];
  'state:discovered': [StateDiscoveredEvent];
  progress: [ProgressEvent];
  checkpoint: [CheckpointEvent];
  'run:error': [ErrorEvent];
  log: [LogEvent];
  'a2a:task': [A2ATaskEvent];
  'a2a:message': [A2AMessageEvent];
  'a2a:blackboard': [A2ABlackboardEvent];
}

export type EngineEventName = keyof EngineEventMap;

/**
 * Typed event emitter for streaming engine progress.
 *
 * Usage:
 * ```ts
 * const emitter = new EngineEventEmitter();
 * emitter.on("task:complete", (evt) => console.log(evt.outcome));
 * ```
 */
export class EngineEventEmitter extends EventEmitter<EngineEventMap> {}

/**
 * Helper to safely emit an event on an optional emitter.
 * Returns immediately if emitter is undefined.
 */
export function emitEngineEvent<E extends EngineEventName>(
  emitter: EngineEventEmitter | undefined,
  event: E,
  payload: EngineEventMap[E][0]
): void {
  if (!emitter) return;
  try {
    (emitter.emit as (event: E, payload: EngineEventMap[E][0]) => boolean)(event, payload);
  } catch {
    // A misbehaving event listener must never crash the engine loop.
  }
}
