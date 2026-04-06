/**
 * Type definitions based on Google's Agent-to-Agent (A2A) protocol.
 *
 * The A2A protocol enables inter-agent communication through a standard
 * set of types: Agent Cards describe capabilities, Tasks represent work
 * units, Messages carry communication, and Artifacts hold outputs.
 *
 * @see https://google.github.io/A2A/
 */

import type { WorkerType, AgentRole } from "../types.js";

// Re-export AgentRole from the canonical location
export type { AgentRole } from "../types.js";

// ---------------------------------------------------------------------------
// Agent Card  (A2A §3.1)
// ---------------------------------------------------------------------------

/** A skill an agent can perform. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  /** Worker types this skill can handle. */
  workerTypes: WorkerType[];
  /** Tags for capability matching. */
  tags: string[];
}

/**
 * An Agent Card describes a specialized agent's identity and capabilities.
 *
 * Modeled after the A2A AgentCard specification — each agent advertises
 * what it can do so the Coordinator can route tasks to the best fit.
 */
export interface AgentCard {
  /** Unique identifier for this agent. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** One-line description of the agent's purpose. */
  description: string;
  /** The specialized role this agent fills. */
  role: AgentRole;
  /** Skills the agent can perform. */
  skills: AgentSkill[];
  /** Worker types this agent is compatible with. */
  supportedWorkerTypes: WorkerType[];
  /** A2A protocol version. */
  protocolVersion: string;
}

// ---------------------------------------------------------------------------
// Message Parts  (A2A §3.3)
// ---------------------------------------------------------------------------

export interface TextPart {
  kind: "text";
  text: string;
}

export interface DataPart {
  kind: "data";
  mimeType: string;
  /** Serialized JSON payload. */
  data: Record<string, unknown>;
}

export interface FilePart {
  kind: "file";
  mimeType: string;
  path: string;
}

export type Part = TextPart | DataPart | FilePart;

// ---------------------------------------------------------------------------
// Message  (A2A §3.2)
// ---------------------------------------------------------------------------

export interface A2AMessage {
  id: string;
  /** Agent that sent the message. */
  fromAgent: string;
  /** Agent that should receive the message, or "*" for broadcast. */
  toAgent: string;
  role: "agent" | "coordinator";
  parts: Part[];
  timestamp: string;
  /** Optional correlation id for request/response pairs. */
  correlationId?: string;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Artifact  (A2A §3.4)
// ---------------------------------------------------------------------------

/**
 * An artifact produced by an agent during task execution.
 * Examples: screenshots, findings reports, coverage snapshots.
 */
export interface A2AArtifact {
  id: string;
  name: string;
  description: string;
  parts: Part[];
  agentId: string;
  taskId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Task  (A2A §3.5)
// ---------------------------------------------------------------------------

export type A2ATaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled";

export interface A2ATaskStatusUpdate {
  status: A2ATaskStatus;
  timestamp: string;
  message?: A2AMessage;
}

/**
 * An A2A Task is a unit of work assigned to an agent.
 */
export interface A2ATask {
  id: string;
  /** The agent card id of the assigned agent. */
  assignedAgent: string;
  /** Current status. */
  status: A2ATaskStatus;
  /** Conversation history for this task. */
  messages: A2AMessage[];
  /** Artifacts produced during execution. */
  artifacts: A2AArtifact[];
  /** Status history. */
  history: A2ATaskStatusUpdate[];
  /** Metadata. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Blackboard Entry Types
// ---------------------------------------------------------------------------

export type BlackboardEntryKind =
  | "finding"
  | "coverage"
  | "navigation"
  | "message"
  | "directive";

export interface BlackboardEntry {
  id: string;
  kind: BlackboardEntryKind;
  agentId: string;
  /** Structured payload. */
  data: Record<string, unknown>;
  timestamp: string;
  /** Tags for filtering. */
  tags: string[];
}
