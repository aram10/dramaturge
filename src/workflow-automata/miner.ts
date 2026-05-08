// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { ExplorationLedger, StateEdge, StateNode } from '../types.js';
import { createWorkflowState, workflowStateKeyId } from './state-abstractor.js';
import { detectWorkflowAnomalies } from './anomaly-detector.js';
import { normalizeWorkflowTrace } from './trace-normalizer.js';
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

function createStateMap(
  nodes: StateNode[],
  authProfile: string | undefined,
  includeAuthProfile: boolean,
  maxStates: number
): { states: WorkflowState[]; statesByNodeId: Map<string, WorkflowState> } {
  const statesById = new Map<string, WorkflowState>();
  const statesByNodeId = new Map<string, WorkflowState>();

  for (const node of nodes) {
    const candidate = createWorkflowState(node, authProfile, includeAuthProfile);
    const existing = statesById.get(candidate.id);
    if (!existing && statesById.size >= maxStates) {
      continue;
    }
    if (existing) {
      existing.sourceNodeIds = Array.from(new Set([...existing.sourceNodeIds, node.id]));
      existing.observationCount += Math.max(node.timesVisited, 1);
      existing.lastObservedAt = node.firstSeenAt;
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
  const {
    nodes,
    edges,
    ledger,
    targetUrl,
    runId,
    authProfile,
    includeAuthProfile,
    includeApiSignals,
    redactValues,
    maxStates,
    maxTransitions,
    minTransitionObservations,
    nondeterminismThreshold,
    lowConfidenceThreshold,
    destructiveTransitionConfirmationRequired,
    comparison,
  } = options;
  const { states, statesByNodeId } = createStateMap(
    nodes,
    authProfile,
    includeAuthProfile,
    maxStates
  );
  const normalized = normalizeWorkflowTrace({
    nodes,
    edges,
    ledger,
    authProfile,
    redactValues,
    includeAuthProfile,
    includeApiSignals,
  });
  const transitionsById = new Map<string, WorkflowTransition>();

  for (const event of normalized.events) {
    if (!event.sourceNodeId || !event.abstractStateBefore || !event.abstractStateAfter) {
      continue;
    }
    const fromState = statesByNodeId.get(event.sourceNodeId);
    const toStateId = workflowStateKeyId(event.abstractStateAfter);
    if (!fromState) {
      continue;
    }
    const transitionId = [
      fromState.id,
      toStateId,
      event.abstractAction.normalizedLabel,
      event.outcome,
      authProfile ?? 'none',
    ].join('::');
    const existing = transitionsById.get(transitionId);
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
    if (existing) {
      existing.observationCount += 1;
      if (event.outcome === 'success') {
        existing.successCount += 1;
      } else if (event.outcome !== 'unknown') {
        existing.failureCount += 1;
      }
      existing.lastObservedAt = event.timestamp;
      existing.evidenceIds = Array.from(new Set([...existing.evidenceIds, ...event.evidenceIds]));
      existing.findingRefs = Array.from(new Set([...existing.findingRefs, ...event.findingRefs]));
      existing.sourceEdgeIds = Array.from(
        new Set([...existing.sourceEdgeIds, ...(event.sourceEdgeId ? [event.sourceEdgeId] : [])])
      );
      existing.sourceActionIds = Array.from(
        new Set([
          ...existing.sourceActionIds,
          ...(event.sourceActionId ? [event.sourceActionId] : []),
        ])
      );
      existing.apiEndpointRefs = Array.from(
        new Set([...(existing.apiEndpointRefs ?? []), ...apiEndpointRefs])
      );
      if (!existing.guard?.apiStatusClass && apiStatusClasses.length === 1) {
        existing.guard = {
          ...existing.guard,
          apiStatusClass: apiStatusClasses[0],
        };
      }
      existing.confidence = transitionConfidence(existing);
      continue;
    }

    const transition: WorkflowTransition = {
      id: `wf-transition-${transitionsById.size + 1}`,
      fromStateId: fromState.id,
      toStateId,
      action: event.abstractAction,
      outcome: event.outcome,
      guard: {
        authProfile,
        requiresConfirmation: event.abstractAction.destructive || undefined,
        requiresValidForm:
          fromState.kind === 'form' || fromState.kind === 'wizard-step' ? true : undefined,
        apiStatusClass: apiStatusClasses.length === 1 ? apiStatusClasses[0] : undefined,
      },
      sourceEdgeIds: event.sourceEdgeId ? [event.sourceEdgeId] : [],
      sourceActionIds: event.sourceActionId ? [event.sourceActionId] : [],
      evidenceIds: [...event.evidenceIds],
      findingRefs: [...event.findingRefs],
      apiEndpointRefs,
      observationCount: 1,
      successCount: event.outcome === 'success' ? 1 : 0,
      failureCount: event.outcome !== 'success' && event.outcome !== 'unknown' ? 1 : 0,
      confidence: 0.35,
      firstObservedAt: event.timestamp,
      lastObservedAt: event.timestamp,
    };
    transition.confidence = transitionConfidence(transition);
    transitionsById.set(transitionId, transition);
  }

  const transitions = [...transitionsById.values()].slice(0, maxTransitions);
  const automaton: WorkflowAutomaton = {
    version: 1,
    createdAt: new Date().toISOString(),
    targetUrl,
    runId,
    authProfile,
    states: states.map((state) => ({
      ...state,
      confidence: stateConfidence(state),
    })),
    transitions,
    anomalies: [],
    metrics: {
      stateCount: states.length,
      transitionCount: transitions.length,
      anomalyCount: 0,
      lowConfidenceTransitionCount: transitions.filter(
        (transition) => transition.confidence < lowConfidenceThreshold
      ).length,
      nondeterministicActionCount: 0,
      crossRoleComparisonCount: comparison?.roleDifferences.length ?? 0,
    },
  };

  const anomalies = detectWorkflowAnomalies(automaton, {
    minTransitionObservations,
    nondeterminismThreshold,
    lowConfidenceThreshold,
    destructiveTransitionConfirmationRequired,
    authProfile,
    comparison,
  });
  automaton.anomalies = anomalies;
  automaton.metrics.anomalyCount = anomalies.length;
  automaton.metrics.nondeterministicActionCount = anomalies.filter(
    (anomaly) => anomaly.type === 'nondeterministic-transition'
  ).length;

  return automaton;
}
