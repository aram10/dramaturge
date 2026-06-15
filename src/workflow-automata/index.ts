// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

// TODO(speculative): The workflow-automata subsystem (state-machine mining from
// click traces, anomaly detection, and Mermaid rendering) is SPECULATIVE. It is
// gated behind `experimental.workflowAutomata.enabled` (default: false) and has
// not yet demonstrated that the mined automata meaningfully improve planning,
// finding quality, or reporting over the existing state graph.
//
// Action required: design and run experiments that quantify its value (e.g.
// does feeding mined follow-ups back into the planner surface bugs the baseline
// misses?). If it cannot justify its ~2k LOC of maintenance surface, this
// subsystem should be removed. Do not expand it further without that evidence.

export { compareWorkflowAutomata, mineWorkflowAutomaton } from './miner.js';
export {
  generateWorkflowFollowups,
  updateWorkflowAutomataRuntime,
  finalizeWorkflowAutomata,
} from './planner-adapter.js';
export {
  loadPreviousWorkflowAutomaton,
  listPeerWorkflowAutomata,
  persistWorkflowAutomatonSnapshot,
} from './persistence.js';
export { renderWorkflowAutomatonMermaid } from './render-mermaid.js';
export {
  collapseRouteFamily,
  buildWorkflowStateKey,
  createWorkflowState,
} from './state-abstractor.js';
export { normalizeWorkflowTrace } from './trace-normalizer.js';
export type {
  WorkflowAction,
  WorkflowAnomaly,
  WorkflowAutomaton,
  WorkflowAutomatonComparison,
  WorkflowAutomataRuntimeState,
  WorkflowFollowupCandidate,
  WorkflowGuard,
  WorkflowState,
  WorkflowStateKey,
  WorkflowTraceEvent,
  WorkflowTransition,
} from './types.js';
