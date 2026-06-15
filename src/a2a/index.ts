// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

// TODO(speculative): The A2A multi-agent coordination layer (Coordinator,
// Blackboard, MessageBus, and the five agent roles) is SPECULATIVE. It is
// gated behind `a2a.enabled` (default: false) and is not yet proven to improve
// finding quality, coverage, or cost over the single-agent engine loop.
//
// Action required: design and run experiments (e.g. an evals/benchmark
// comparison of a2a-enabled vs. a2a-disabled runs on the same targets) that
// demonstrate a measurable benefit. If it cannot earn its ~1.9k LOC of
// maintenance surface, this subsystem should be removed. Do not expand it
// further without that evidence.

export type {
  AgentRole,
  AgentCard,
  AgentSkill,
  A2AMessage,
  A2ATask,
  A2ATaskStatus,
  A2ATaskStatusUpdate,
  A2AArtifact,
  Part,
  TextPart,
  DataPart,
  FilePart,
  BlackboardEntry,
  BlackboardEntryKind,
} from './types.js';
export {
  AGENT_CARDS,
  agentRoleForWorkerType,
  agentCardForWorkerType,
  findCapableAgents,
} from './agent-cards.js';
export { Blackboard } from './blackboard.js';
export { MessageBus } from './message-bus.js';
export { Coordinator } from './coordinator.js';
export type { CoordinatorDeps } from './coordinator.js';
