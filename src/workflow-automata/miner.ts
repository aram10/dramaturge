// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { createHash } from 'node:crypto';
import type { ExplorationLedger, StateEdge, StateNode } from '../types.js';
import { detectWorkflowAnomalies } from './anomaly-detector.js';
import { createWorkflowState, workflowStateKeyId } from './state-abstractor.js';
import { normalizeWorkflowTrace } from './trace-normalizer.js';
import { BASE_WORKFLOW_CONFIDENCE } from './types.js';
import type {
  WorkflowAutomaton,
  WorkflowAutomatonComparison,
  WorkflowState,
  WorkflowTransition,
} from './types.js';

export interface MineWorkflowAutomatonOptions {
  nodes: StateNode[];
  edges: StateEdge[];
  ledger?: ExplorationLedger;
  targetUrl: string;
  runId?: string;
  authProfile?: string;
  includeAuthProfile: boolean;
  includeApiSignals: boolean;
  includeModalState?: boolean;
  includeFormValidity?: boolean;
  redactValues: boolean;
  maxStates: number;
  maxTransitions: number;
  minTransitionObservations: number;
  nondeterminismThreshold: number;
  lowConfidenceThreshold: number;
  destructiveTransitionConfirmationRequired: boolean;
  comparison?: WorkflowAutomatonComparison;
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stateConfidence(state: WorkflowState): number {
  let score = 0.2;
  if (state.routeFamily) score += 0.2;
  if (state.pageType) score += 0.15;
  if (state.modalLabel) score += 0.1;
  if (state.formSignature) score += 0.1;
  if ((state.entityHints?.length ?? 0) > 0) score += 0.1;
  score += Math.min(0.25, Math.log2(state.observationCount + 1) * 0.08);
  return clampProbability(score);
}

function transitionConfidence(transition: WorkflowTransition): number {
  const repeatability = Math.min(0.4, Math.log2(transition.observationCount + 1) * 0.1);
  const successRatio =
    transition.observationCount > 0 ? transition.successCount / transition.observationCount : 0;
  const conflictPenalty = transition.failureCount > 0 ? 0.15 : 0;
  const guardBoost = transition.guard?.authProfile ? 0.05 : 0;
  return clampProbability(0.35 + repeatability + successRatio * 0.2 + guardBoost - conflictPenalty);
}

function buildTransitionLabel(transition: WorkflowTransition): string {
  return `${transition.fromStateId}:${transition.action.normalizedLabel}:${transition.toStateId}:${transition.outcome}:${transition.guard?.authProfile ?? 'none'}`;
}

interface StateMapFlags {
  includeAuthProfile: boolean;
  includeModalState: boolean;
  includeFormValidity: boolean;
}

function createStateMap(
  nodes: StateNode[],
  authProfile: string | undefined,
  maxStates: number,
  flags: StateMapFlags
): { states: WorkflowState[]; statesByNodeId: Map<string, WorkflowState> } {
  const statesById = new Map<string, WorkflowState>();
  const statesByNodeId = new Map<string, WorkflowState>();

  for (const node of nodes) {
    const candidate = createWorkflowState(
      node,
      authProfile,
      flags.includeAuthProfile,
      flags.includeModalState,
      flags.includeFormValidity
    );
    const existing = statesById.get(candidate.id);
    if (!existing && statesById.size >= maxStates) {
      continue;
    }
    if (existing) {
      existing.sourceNodeIds = Array.from(new Set([...existing.sourceNodeIds, node.id]));
      existing.observationCount += Math.max(node.timesVisited, 1);
      if (node.firstSeenAt > existing.lastObservedAt) {
        // ISO 8601 timestamps are lexicographically sortable, so string comparison is correct here.
        existing.lastObservedAt = node.firstSeenAt;
      }
      existing.entityHints = Array.from(
        new Set([...(existing.entityHints ?? []), ...(candidate.entityHints ?? [])])
      );
      if (!existing.formSignature) existing.formSignature = candidate.formSignature;
      if (!existing.modalLabel) existing.modalLabel = candidate.modalLabel;
      if (!existing.controlSignature) existing.controlSignature = candidate.controlSignature;
      existing.confidence = stateConfidence(existing);
      statesByNodeId.set(node.id, existing);
      continue;
    }
    candidate.confidence = stateConfidence(candidate);
    statesById.set(candidate.id, candidate);
    statesByNodeId.set(node.id, candidate);
  }

  return { states: [...statesById.values()], statesByNodeId };
}

function buildApiRefs(event: ReturnType<typeof normalizeWorkflowTrace>['events'][number]): {
  apiStatusClasses: string[];
  apiEndpointRefs: string[];
} {
  const apiStatusClasses = Array.from(
    new Set((event.apiSignals ?? []).map((signal) => signal.statusClass))
  ).filter((value) => value !== '0xx');
  const apiEndpointRefs = Array.from(
    new Set(
      (event.apiSignals ?? []).map(
        (signal) => `${signal.method.toUpperCase()} ${signal.route} [${signal.statusClass}]`
      )
    )
  );
  return { apiStatusClasses, apiEndpointRefs };
}

function transitionKey(
  fromStateId: string,
  toStateId: string,
  normalizedAction: string,
  outcome: string,
  authProfile: string | undefined
): string {
  return [fromStateId, toStateId, normalizedAction, outcome, authProfile ?? 'none'].join('::');
}

function mergeTransitionObservation(
  transition: WorkflowTransition,
  event: ReturnType<typeof normalizeWorkflowTrace>['events'][number],
  apiStatusClasses: string[],
  apiEndpointRefs: string[]
): void {
  transition.observationCount += 1;
  if (event.outcome === 'success') {
    transition.successCount += 1;
  } else if (event.outcome !== 'unknown') {
    transition.failureCount += 1;
  }
  transition.lastObservedAt = event.timestamp;
  transition.evidenceIds = Array.from(new Set([...transition.evidenceIds, ...event.evidenceIds]));
  transition.findingRefs = Array.from(new Set([...transition.findingRefs, ...event.findingRefs]));
  transition.sourceEdgeIds = Array.from(
    new Set([...transition.sourceEdgeIds, ...(event.sourceEdgeId ? [event.sourceEdgeId] : [])])
  );
  transition.sourceActionIds = Array.from(
    new Set([
      ...transition.sourceActionIds,
      ...(event.sourceActionId ? [event.sourceActionId] : []),
    ])
  );
  transition.apiEndpointRefs = Array.from(
    new Set([...(transition.apiEndpointRefs ?? []), ...apiEndpointRefs])
  );
  if (!transition.guard?.apiStatusClass && apiStatusClasses.length === 1) {
    transition.guard = {
      ...transition.guard,
      apiStatusClass: apiStatusClasses[0] as '2xx' | '3xx' | '4xx' | '5xx',
    };
  }
  transition.confidence = transitionConfidence(transition);
}

function createTransition(input: {
  fromState: WorkflowState;
  toStateId: string;
  transitionKey: string;
  authProfile: string | undefined;
  event: ReturnType<typeof normalizeWorkflowTrace>['events'][number];
  apiStatusClasses: string[];
  apiEndpointRefs: string[];
}): WorkflowTransition {
  const {
    fromState,
    toStateId,
    transitionKey: tKey,
    authProfile,
    event,
    apiStatusClasses,
    apiEndpointRefs,
  } = input;
  const transition: WorkflowTransition = {
    // Use 16 hex chars (64 bits) — collision probability is negligible for the expected
    // number of transitions per run (well below 2^32 birthday-bound threshold).
    id: `wf-transition-${createHash('sha256').update(tKey).digest('hex').slice(0, 16)}`,
    fromStateId: fromState.id,
    toStateId,
    action: event.abstractAction,
    outcome: event.outcome,
    guard: {
      authProfile,
      requiresConfirmation: event.abstractAction.destructive || undefined,
      requiresValidForm:
        fromState.kind === 'form' || fromState.kind === 'wizard-step' ? true : undefined,
      apiStatusClass:
        apiStatusClasses.length === 1
          ? (apiStatusClasses[0] as '2xx' | '3xx' | '4xx' | '5xx')
          : undefined,
    },
    sourceEdgeIds: event.sourceEdgeId ? [event.sourceEdgeId] : [],
    sourceActionIds: event.sourceActionId ? [event.sourceActionId] : [],
    evidenceIds: [...event.evidenceIds],
    findingRefs: [...event.findingRefs],
    apiEndpointRefs,
    observationCount: 1,
    successCount: event.outcome === 'success' ? 1 : 0,
    failureCount: event.outcome !== 'success' && event.outcome !== 'unknown' ? 1 : 0,
    confidence: BASE_WORKFLOW_CONFIDENCE,
    firstObservedAt: event.timestamp,
    lastObservedAt: event.timestamp,
  };
  transition.confidence = transitionConfidence(transition);
  return transition;
}

function buildTransitionMap(
  statesByNodeId: Map<string, WorkflowState>,
  normalized: ReturnType<typeof normalizeWorkflowTrace>,
  authProfile: string | undefined
): Map<string, WorkflowTransition> {
  const transitionsById = new Map<string, WorkflowTransition>();

  for (const event of normalized.events) {
    if (!event.sourceNodeId || !event.abstractStateBefore || !event.abstractStateAfter) {
      continue;
    }
    const fromState = statesByNodeId.get(event.sourceNodeId);
    if (!fromState) {
      continue;
    }
    const toStateId = workflowStateKeyId(event.abstractStateAfter);
    const key = transitionKey(
      fromState.id,
      toStateId,
      event.abstractAction.normalizedLabel,
      event.outcome,
      authProfile
    );
    const { apiStatusClasses, apiEndpointRefs } = buildApiRefs(event);
    const existing = transitionsById.get(key);
    if (existing) {
      mergeTransitionObservation(existing, event, apiStatusClasses, apiEndpointRefs);
      continue;
    }
    transitionsById.set(
      key,
      createTransition({
        fromState,
        toStateId,
        transitionKey: key,
        authProfile,
        event,
        apiStatusClasses,
        apiEndpointRefs,
      })
    );
  }

  return transitionsById;
}

function buildMetrics(
  states: WorkflowState[],
  transitions: WorkflowTransition[],
  lowConfidenceThreshold: number,
  comparison: WorkflowAutomatonComparison | undefined
): WorkflowAutomaton['metrics'] {
  return {
    stateCount: states.length,
    transitionCount: transitions.length,
    anomalyCount: 0,
    lowConfidenceTransitionCount: transitions.filter(
      (transition) => transition.confidence < lowConfidenceThreshold
    ).length,
    nondeterministicActionCount: 0,
    crossRoleComparisonCount: comparison?.roleDifferences.length ?? 0,
  };
}

export function finalizeAutomaton(
  automaton: WorkflowAutomaton,
  options: Pick<
    MineWorkflowAutomatonOptions,
    | 'minTransitionObservations'
    | 'nondeterminismThreshold'
    | 'lowConfidenceThreshold'
    | 'destructiveTransitionConfirmationRequired'
    | 'comparison'
    | 'authProfile'
  >
): WorkflowAutomaton {
  if (options.comparison) {
    automaton.metrics.crossRoleComparisonCount = options.comparison.roleDifferences.length;
  }
  const anomalies = detectWorkflowAnomalies(automaton, {
    minTransitionObservations: options.minTransitionObservations,
    nondeterminismThreshold: options.nondeterminismThreshold,
    lowConfidenceThreshold: options.lowConfidenceThreshold,
    destructiveTransitionConfirmationRequired: options.destructiveTransitionConfirmationRequired,
    authProfile: options.authProfile,
    comparison: options.comparison,
  });
  automaton.anomalies = anomalies;
  automaton.metrics.anomalyCount = anomalies.length;
  automaton.metrics.nondeterministicActionCount = anomalies.filter(
    (anomaly) => anomaly.type === 'nondeterministic-transition'
  ).length;
  return automaton;
}

export function compareWorkflowAutomata(
  current: WorkflowAutomaton,
  previous: WorkflowAutomaton | undefined,
  peers: WorkflowAutomaton[] = []
): WorkflowAutomatonComparison {
  const currentStateLabels = new Set(current.states.map((state) => state.label));
  const previousStateLabels = new Set(previous?.states.map((state) => state.label) ?? []);
  const currentTransitionLabels = new Set(
    current.transitions.map((transition) => buildTransitionLabel(transition))
  );
  const previousTransitionLabels = new Set(
    previous?.transitions.map((transition) => buildTransitionLabel(transition)) ?? []
  );
  const roleDifferences: string[] = [];

  for (const peer of peers) {
    const peerRouteFamilies = new Set(
      peer.states.map((state) => state.routeFamily).filter(Boolean)
    );
    for (const state of current.states) {
      if (!state.routeFamily || !peerRouteFamilies.has(state.routeFamily)) {
        continue;
      }
      if (peer.authProfile && current.authProfile && peer.authProfile !== current.authProfile) {
        const peerOnlyState = peer.states.find(
          (candidate) =>
            candidate.routeFamily === state.routeFamily && candidate.label !== state.label
        );
        if (peerOnlyState) {
          roleDifferences.push(
            `${current.authProfile} reached ${state.routeFamily}, which differs from ${peer.authProfile} observations.`
          );
        }
      }
    }
  }

  return {
    previousRunFound: Boolean(previous),
    previousCreatedAt: previous?.createdAt,
    previousAuthProfile: previous?.authProfile,
    addedStateLabels: [...currentStateLabels]
      .filter((label) => !previousStateLabels.has(label))
      .slice(0, 12),
    removedStateLabels: [...previousStateLabels]
      .filter((label) => !currentStateLabels.has(label))
      .slice(0, 12),
    addedTransitionLabels: [...currentTransitionLabels]
      .filter((label) => !previousTransitionLabels.has(label))
      .slice(0, 12),
    removedTransitionLabels: [...previousTransitionLabels]
      .filter((label) => !currentTransitionLabels.has(label))
      .slice(0, 12),
    peerProfiles: peers
      .map((peer) => peer.authProfile)
      .filter((value): value is string => Boolean(value)),
    roleDifferences: Array.from(new Set(roleDifferences)).slice(0, 12),
  };
}

export function mineWorkflowAutomaton(options: MineWorkflowAutomatonOptions): WorkflowAutomaton {
  const includeModalState = options.includeModalState ?? true;
  const includeFormValidity = options.includeFormValidity ?? true;
  const stateMap = createStateMap(options.nodes, options.authProfile, options.maxStates, {
    includeAuthProfile: options.includeAuthProfile,
    includeModalState,
    includeFormValidity,
  });
  const normalized = normalizeWorkflowTrace({
    nodes: options.nodes,
    edges: options.edges,
    ledger: options.ledger,
    authProfile: options.authProfile,
    redactValues: options.redactValues,
    includeAuthProfile: options.includeAuthProfile,
    includeApiSignals: options.includeApiSignals,
    includeModalState,
    includeFormValidity,
  });
  const transitions = [
    ...buildTransitionMap(stateMap.statesByNodeId, normalized, options.authProfile).values(),
  ].slice(0, options.maxTransitions);
  const automaton: WorkflowAutomaton = {
    version: 1,
    createdAt: new Date().toISOString(),
    targetUrl: options.targetUrl,
    runId: options.runId,
    authProfile: options.authProfile,
    states: stateMap.states.map((state) => ({
      ...state,
      confidence: stateConfidence(state),
    })),
    transitions,
    anomalies: [],
    metrics: buildMetrics(
      stateMap.states,
      transitions,
      options.lowConfidenceThreshold,
      options.comparison
    ),
  };

  return finalizeAutomaton(automaton, options);
}
