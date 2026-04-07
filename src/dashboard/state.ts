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
import type { AgentRole } from "../types.js";
import type { A2ATaskStatus, BlackboardEntryKind } from "../a2a/types.js";

// --- Activity feed item ---

export type ActivityKind =
  | "task-start"
  | "task-complete"
  | "finding"
  | "state-discovered"
  | "error"
  | "a2a-task"
  | "a2a-message"
  | "a2a-blackboard";

export interface ActivityItem {
  id: number;
  kind: ActivityKind;
  text: string;
  timestamp: number;
}

// --- A2A agent status tracking ---

export interface AgentStatus {
  agentId: string;
  role: AgentRole;
  /** Number of tasks assigned to this agent. */
  tasksAssigned: number;
  /** Number of tasks completed by this agent. */
  tasksCompleted: number;
  /** Number of messages sent by this agent. */
  messagesSent: number;
  /** Number of blackboard entries posted by this agent. */
  blackboardPosts: number;
  /** Current status label for display. */
  currentStatus: "idle" | "working" | "completed";
}

// --- A2A event payloads ---

export interface A2ATaskEvent {
  taskId: string;
  agentId: string;
  agentRole: AgentRole;
  status: A2ATaskStatus;
  objective: string;
}

export interface A2AMessageEvent {
  fromAgent: string;
  toAgent: string;
  text: string;
}

export interface A2ABlackboardEvent {
  kind: BlackboardEntryKind;
  agentId: string;
  summary: string;
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
  /** Monotonic counter for generating stable activity item IDs. */
  activitySeq: number;

  // --- A2A multi-agent state ---

  /** Whether A2A multi-agent mode is active. */
  a2aEnabled: boolean;
  /** Per-agent status tracking, keyed by agent id. */
  agents: Readonly<Record<string, AgentStatus>>;
  /** Total A2A tasks assigned. */
  a2aTasksTotal: number;
  /** Total inter-agent messages. */
  a2aMessagesTotal: number;
  /** Total blackboard entries. */
  a2aBlackboardTotal: number;
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
    activitySeq: 0,
    a2aEnabled: false,
    agents: {},
    a2aTasksTotal: 0,
    a2aMessagesTotal: 0,
    a2aBlackboardTotal: 0,
  };
}

// --- Reducers (pure functions) ---

function pushActivity(
  state: DashboardState,
  kind: ActivityKind,
  text: string,
  timestamp: number
): DashboardState {
  const id = state.activitySeq + 1;
  const item: ActivityItem = { id, kind, text, timestamp };
  const activity = [item, ...state.activity].slice(0, MAX_ACTIVITY);
  return { ...state, activity, activitySeq: id };
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
  evt: TaskStartEvent,
  now: number = Date.now()
): DashboardState {
  const text = `[task ${evt.taskNumber}] ${evt.workerType}: ${evt.objective}`;
  return pushActivity(state, "task-start", text, now);
}

export function applyTaskComplete(
  state: DashboardState,
  evt: TaskCompleteEvent,
  now: number = Date.now()
): DashboardState {
  const coverage =
    evt.coverageExercised > 0
      ? ` | coverage: ${evt.coverageExercised}/${evt.coverageDiscovered}`
      : "";
  const text = `[task ${evt.taskNumber}] ${evt.outcome}: ${evt.findingsCount} finding(s)${coverage}`;
  return pushActivity(state, "task-complete", text, now);
}

export function applyFinding(
  state: DashboardState,
  evt: FindingEvent,
  now: number = Date.now()
): DashboardState {
  const text = `⚠ [${evt.severity}] ${evt.title}`;
  return pushActivity(state, "finding", text, now);
}

export function applyStateDiscovered(
  state: DashboardState,
  evt: StateDiscoveredEvent,
  now: number = Date.now()
): DashboardState {
  const text = `↳ new state: ${evt.pageType} (${evt.totalStates} total)`;
  return pushActivity(state, "state-discovered", text, now);
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
  evt: ErrorEvent,
  now: number = Date.now()
): DashboardState {
  const text = `Error [${evt.phase}]: ${evt.message}`;
  return { ...pushActivity(state, "error", text, now), lastError: evt.message };
}

// --- A2A reducers ---

function ensureAgent(
  agents: Readonly<Record<string, AgentStatus>>,
  agentId: string,
  role: AgentRole
): Record<string, AgentStatus> {
  if (agents[agentId]) return { ...agents };
  return {
    ...agents,
    [agentId]: {
      agentId,
      role,
      tasksAssigned: 0,
      tasksCompleted: 0,
      messagesSent: 0,
      blackboardPosts: 0,
      currentStatus: "idle",
    },
  };
}

export function applyA2ATask(
  state: DashboardState,
  evt: A2ATaskEvent,
  now: number = Date.now()
): DashboardState {
  const agents = ensureAgent(state.agents, evt.agentId, evt.agentRole);
  const agent = agents[evt.agentId];

  const isAssignment = evt.status === "submitted" || evt.status === "working";
  const isCompletion = evt.status === "completed";

  agents[evt.agentId] = {
    ...agent,
    tasksAssigned: isAssignment ? agent.tasksAssigned + 1 : agent.tasksAssigned,
    tasksCompleted: isCompletion ? agent.tasksCompleted + 1 : agent.tasksCompleted,
    currentStatus: isCompletion ? "completed" : "working",
  };

  const statusLabel = evt.status === "submitted" ? "→" : evt.status === "completed" ? "✓" : "●";
  const text = `${statusLabel} [${evt.agentRole}] ${evt.objective}`;

  return {
    ...pushActivity(
      { ...state, a2aEnabled: true, agents, a2aTasksTotal: state.a2aTasksTotal + 1 },
      "a2a-task",
      text,
      now
    ),
  };
}

export function applyA2AMessage(
  state: DashboardState,
  evt: A2AMessageEvent,
  now: number = Date.now()
): DashboardState {
  const target = evt.toAgent === "*" ? "all" : evt.toAgent;
  const text = `✉ ${evt.fromAgent} → ${target}: ${evt.text}`;

  // Increment messagesSent on the sender's agent if already tracked
  let agents = state.agents;
  const sender = agents[evt.fromAgent];
  if (sender) {
    agents = {
      ...agents,
      [evt.fromAgent]: { ...sender, messagesSent: sender.messagesSent + 1 },
    };
  }

  return pushActivity(
    { ...state, a2aEnabled: true, agents, a2aMessagesTotal: state.a2aMessagesTotal + 1 },
    "a2a-message",
    text,
    now
  );
}

export function applyA2ABlackboard(
  state: DashboardState,
  evt: A2ABlackboardEvent,
  now: number = Date.now()
): DashboardState {
  const agents = ensureAgent(
    state.agents,
    evt.agentId,
    guessRoleFromAgentId(evt.agentId)
  );
  const agent = agents[evt.agentId];
  agents[evt.agentId] = {
    ...agent,
    blackboardPosts: agent.blackboardPosts + 1,
  };

  const text = `📋 [${evt.kind}] (${evt.agentId}) ${evt.summary}`;

  return pushActivity(
    { ...state, a2aEnabled: true, agents, a2aBlackboardTotal: state.a2aBlackboardTotal + 1 },
    "a2a-blackboard",
    text,
    now
  );
}

/** Best-effort role inference from agent id. Falls back to "reporter". */
function guessRoleFromAgentId(agentId: string): AgentRole {
  if (agentId.includes("scout")) return "scout";
  if (agentId.includes("tester")) return "tester";
  if (agentId.includes("security")) return "security";
  if (agentId.includes("reviewer")) return "reviewer";
  return "reporter";
}
