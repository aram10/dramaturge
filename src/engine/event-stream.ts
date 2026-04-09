// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { EventEmitter } from 'node:events';
import type {
  RawFinding,
  WorkerResult,
  FrontierItem,
  FindingSeverity,
  WorkerType,
} from '../types.js';

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
  (emitter.emit as (event: E, payload: EngineEventMap[E][0]) => boolean)(event, payload);
}
