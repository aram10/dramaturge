import type {
  RunStartEvent,
  RunEndEvent,
  TaskStartEvent,
  TaskCompleteEvent,
  FindingEvent,
  StateDiscoveredEvent,
  ProgressEvent,
  ErrorEvent,
} from "../engine/event-stream.js";

// --- Activity feed item ---

export type ActivityKind =
  | "task-start"
  | "task-complete"
  | "finding"
  | "state-discovered"
  | "error";

export interface ActivityItem {
  kind: ActivityKind;
  text: string;
  timestamp: number;
}

// --- Dashboard state ---

export interface DashboardState {
  /** Target URL being tested. */
  targetUrl: string;
  /** Whether the run has started. */
  running: boolean;
  /** Whether the run has finished. */
  finished: boolean;
  /** Time limit in seconds. */
  timeLimitSeconds: number;
  /** Concurrency level. */
  concurrency: number;
  /** Tasks completed so far. */
  tasksExecuted: number;
  /** Tasks remaining in queue. */
  tasksRemaining: number;
  /** Total findings discovered. */
  totalFindings: number;
  /** Total states (pages) discovered. */
  statesDiscovered: number;
  /** Estimated progress from 0 to 1. */
  estimatedProgress: number;
  /** Elapsed time in milliseconds. */
  elapsedMs: number;
  /** Duration of the completed run in ms (set on run:end). */
  durationMs: number;
  /** Most recent activity items (newest first, capped). */
  activity: readonly ActivityItem[];
  /** Most recent error message, if any. */
  lastError: string | undefined;
}

/** Maximum number of activity items to keep. */
const MAX_ACTIVITY = 50;

export function initialDashboardState(): DashboardState {
  return {
    targetUrl: "",
    running: false,
    finished: false,
    timeLimitSeconds: 0,
    concurrency: 0,
    tasksExecuted: 0,
    tasksRemaining: 0,
    totalFindings: 0,
    statesDiscovered: 0,
    estimatedProgress: 0,
    elapsedMs: 0,
    durationMs: 0,
    activity: [],
    lastError: undefined,
  };
}

// --- Reducers (pure functions) ---

function pushActivity(
  state: DashboardState,
  kind: ActivityKind,
  text: string
): DashboardState {
  const item: ActivityItem = { kind, text, timestamp: Date.now() };
  const activity = [item, ...state.activity].slice(0, MAX_ACTIVITY);
  return { ...state, activity };
}

export function applyRunStart(
  state: DashboardState,
  evt: RunStartEvent
): DashboardState {
  return {
    ...state,
    targetUrl: evt.targetUrl,
    running: true,
    finished: false,
    timeLimitSeconds: evt.budget.timeLimitSeconds,
    concurrency: evt.concurrency,
  };
}

export function applyRunEnd(
  state: DashboardState,
  evt: RunEndEvent
): DashboardState {
  return {
    ...state,
    running: false,
    finished: true,
    tasksExecuted: evt.tasksExecuted,
    totalFindings: evt.totalFindings,
    statesDiscovered: evt.statesDiscovered,
    durationMs: evt.durationMs,
    estimatedProgress: 1,
  };
}

export function applyTaskStart(
  state: DashboardState,
  evt: TaskStartEvent
): DashboardState {
  const text = `[task ${evt.taskNumber}] ${evt.workerType}: ${evt.objective}`;
  return pushActivity(state, "task-start", text);
}

export function applyTaskComplete(
  state: DashboardState,
  evt: TaskCompleteEvent
): DashboardState {
  const coverage =
    evt.coverageExercised > 0
      ? ` | coverage: ${evt.coverageExercised}/${evt.coverageDiscovered}`
      : "";
  const text = `[task ${evt.taskNumber}] ${evt.outcome}: ${evt.findingsCount} finding(s)${coverage}`;
  return pushActivity(state, "task-complete", text);
}

export function applyFinding(
  state: DashboardState,
  evt: FindingEvent
): DashboardState {
  const text = `⚠ [${evt.severity}] ${evt.title}`;
  return pushActivity(state, "finding", text);
}

export function applyStateDiscovered(
  state: DashboardState,
  evt: StateDiscoveredEvent
): DashboardState {
  const text = `↳ new state: ${evt.pageType} (${evt.totalStates} total)`;
  return pushActivity(state, "state-discovered", text);
}

export function applyProgress(
  state: DashboardState,
  evt: ProgressEvent
): DashboardState {
  return {
    ...state,
    tasksExecuted: evt.tasksExecuted,
    tasksRemaining: evt.tasksRemaining,
    totalFindings: evt.totalFindings,
    statesDiscovered: evt.statesDiscovered,
    elapsedMs: evt.elapsedMs,
    estimatedProgress: evt.estimatedProgress,
  };
}

export function applyError(
  state: DashboardState,
  evt: ErrorEvent
): DashboardState {
  const text = `Error [${evt.phase}]: ${evt.message}`;
  return { ...pushActivity(state, "error", text), lastError: evt.message };
}
