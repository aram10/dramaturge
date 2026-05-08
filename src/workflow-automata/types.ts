// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

export type WorkflowStateKind =
  | 'unauthenticated'
  | 'authenticated'
  | 'list'
  | 'detail'
  | 'form'
  | 'wizard-step'
  | 'modal'
  | 'confirmation'
  | 'success'
  | 'error'
  | 'unknown';

export type WorkflowTransitionOutcome =
  | 'success'
  | 'blocked'
  | 'validation-error'
  | 'server-error'
  | 'same-state'
  | 'redirect'
  | 'unknown';

export type WorkflowActionKind =
  | 'navigate'
  | 'click'
  | 'input'
  | 'submit'
  | 'open'
  | 'close'
  | 'toggle'
  | 'api'
  | 'unknown';

export interface WorkflowAction {
  kind: WorkflowActionKind;
  label: string;
  normalizedLabel: string;
  destructive?: boolean;
  selectorHash?: string;
}

export interface WorkflowGuard {
  authProfile?: string;
  roleHint?: string;
  requiresConfirmation?: boolean;
  requiresValidForm?: boolean;
  apiStatusClass?: '2xx' | '3xx' | '4xx' | '5xx';
}

export interface WorkflowStateKey {
  authProfile?: string;
  routeFamily?: string;
  pageType?: string;
  modalLabel?: string;
  formSignature?: string;
  entityStateHint?: string;
  dominantHeading?: string;
  controlClusterSignature?: string;
}

export interface WorkflowState {
  id: string;
  key: WorkflowStateKey;
  label: string;
  kind: WorkflowStateKind;
  routeFamily?: string;
  pageType?: string;
  authProfile?: string;
  modalLabel?: string;
  formSignature?: string;
  entityHints?: string[];
  controlSignature?: string;
  sourceNodeIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
  confidence: number;
}

export interface WorkflowTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  action: WorkflowAction;
  outcome: WorkflowTransitionOutcome;
  guard?: WorkflowGuard;
  sourceEdgeIds: string[];
  sourceActionIds: string[];
  evidenceIds: string[];
  findingRefs: string[];
  apiEndpointRefs?: string[];
  observationCount: number;
  successCount: number;
  failureCount: number;
  confidence: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface WorkflowAnomaly {
  id: string;
  type:
    | 'dead-end'
    | 'same-state-loop'
    | 'nondeterministic-transition'
    | 'missing-confirmation'
    | 'missing-recovery-path'
    | 'cross-role-privilege-leak'
    | 'ui-api-disagreement'
    | 'unexpected-error-transition'
    | 'unexplored-high-value-transition';
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  summary: string;
  stateIds: string[];
  transitionIds: string[];
  evidenceIds: string[];
  suggestedFollowup?: string;
}

export interface WorkflowAutomatonMetrics {
  stateCount: number;
  transitionCount: number;
  anomalyCount: number;
  lowConfidenceTransitionCount: number;
  nondeterministicActionCount: number;
  crossRoleComparisonCount: number;
}

export interface WorkflowAutomaton {
  version: 1;
  createdAt: string;
  targetUrl: string;
  runId?: string;
  authProfile?: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  anomalies: WorkflowAnomaly[];
  metrics: WorkflowAutomatonMetrics;
}

export interface WorkflowAutomatonComparison {
  previousRunFound: boolean;
  previousCreatedAt?: string;
  previousAuthProfile?: string;
  addedStateLabels: string[];
  removedStateLabels: string[];
  addedTransitionLabels: string[];
  removedTransitionLabels: string[];
  peerProfiles: string[];
  roleDifferences: string[];
}

export interface WorkflowApiSignalSummary {
  route: string;
  method: string;
  statusClass: '2xx' | '3xx' | '4xx' | '5xx' | '0xx';
  status: number;
}

export interface WorkflowTraceEvent {
  timestamp: string;
  sourceNodeId?: string;
  sourceEdgeId?: string;
  sourceActionId?: string;
  evidenceIds: string[];
  findingRefs: string[];
  abstractStateBefore?: WorkflowStateKey;
  abstractAction: WorkflowAction;
  abstractStateAfter?: WorkflowStateKey;
  outcome: WorkflowTransitionOutcome;
  routeFamily?: string;
  pageType?: string;
  authProfile?: string;
  apiSignals?: WorkflowApiSignalSummary[];
}

export interface WorkflowFollowupCandidate {
  type:
    | 'verify-anomaly'
    | 'probe-uncertain-transition'
    | 'exercise-unseen-transition'
    | 'cross-role-compare'
    | 'replay-critical-path';
  nodeId?: string;
  workerType: 'navigation' | 'form' | 'crud' | 'api' | 'adversarial';
  objective: string;
  reason: string;
  priorityBoost: number;
  dedupeKey: string;
  relatedWorkflowStateIds: string[];
  relatedWorkflowTransitionIds: string[];
  relatedAnomalyIds: string[];
}

export interface WorkflowAutomataRuntimeState {
  current?: WorkflowAutomaton;
  comparison?: WorkflowAutomatonComparison;
  generatedFollowups: number;
  generatedFollowupKeys: Set<string>;
}
