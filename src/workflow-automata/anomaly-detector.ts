// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { shortId } from '../constants.js';
import type {
  WorkflowAnomaly,
  WorkflowAutomaton,
  WorkflowAutomatonComparison,
  WorkflowTransition,
} from './types.js';

export interface DetectWorkflowAnomaliesOptions {
  minTransitionObservations: number;
  nondeterminismThreshold: number;
  lowConfidenceThreshold: number;
  destructiveTransitionConfirmationRequired: boolean;
  authProfile?: string;
  comparison?: WorkflowAutomatonComparison;
}

function createAnomaly(input: Omit<WorkflowAnomaly, 'id'>): WorkflowAnomaly {
  return {
    id: `wf-anomaly-${shortId()}`,
    ...input,
  };
}

function isTerminalKind(kind: WorkflowAutomaton['states'][number]['kind']): boolean {
  return kind === 'success' || kind === 'error' || kind === 'confirmation';
}

function hasMutatingApiRef(transition: WorkflowTransition): boolean {
  return (transition.apiEndpointRefs ?? []).some((ref) =>
    /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/.test(ref)
  );
}

export function detectWorkflowAnomalies(
  automaton: WorkflowAutomaton,
  options: DetectWorkflowAnomaliesOptions
): WorkflowAnomaly[] {
  const {
    minTransitionObservations,
    nondeterminismThreshold,
    lowConfidenceThreshold,
    destructiveTransitionConfirmationRequired,
    authProfile,
    comparison,
  } = options;
  const anomalies: WorkflowAnomaly[] = [];
  const statesById = new Map(automaton.states.map((state) => [state.id, state]));
  const transitionsByState = new Map<string, WorkflowTransition[]>();
  const transitionsByAction = new Map<string, WorkflowTransition[]>();

  for (const transition of automaton.transitions) {
    const out = transitionsByState.get(transition.fromStateId) ?? [];
    out.push(transition);
    transitionsByState.set(transition.fromStateId, out);

    const guardKey = JSON.stringify({
      from: transition.fromStateId,
      action: transition.action.normalizedLabel,
      authProfile: transition.guard?.authProfile,
      requiresConfirmation: transition.guard?.requiresConfirmation,
      requiresValidForm: transition.guard?.requiresValidForm,
    });
    const grouped = transitionsByAction.get(guardKey) ?? [];
    grouped.push(transition);
    transitionsByAction.set(guardKey, grouped);
  }

  for (const state of automaton.states) {
    const outgoing = transitionsByState.get(state.id) ?? [];
    const successfulOutgoing = outgoing.filter((transition) => transition.outcome === 'success');
    if (
      state.observationCount >= minTransitionObservations &&
      !isTerminalKind(state.kind) &&
      outgoing.length === 0
    ) {
      anomalies.push(
        createAnomaly({
          type: 'dead-end',
          severity: 'medium',
          confidence: Math.min(0.9, 0.45 + state.observationCount * 0.1),
          summary: `${state.label} had no observed outgoing transitions after repeated visits.`,
          stateIds: [state.id],
          transitionIds: [],
          evidenceIds: [],
          suggestedFollowup: `Revisit ${state.label} and probe its next-step controls.`,
        })
      );
    }
    if (
      state.kind === 'error' &&
      state.observationCount >= minTransitionObservations &&
      successfulOutgoing.length === 0
    ) {
      anomalies.push(
        createAnomaly({
          type: 'missing-recovery-path',
          severity: 'medium',
          confidence: Math.min(0.85, 0.4 + state.observationCount * 0.08),
          summary: `${state.label} showed no successful recovery path after an error or validation state.`,
          stateIds: [state.id],
          transitionIds: outgoing.map((transition) => transition.id),
          evidenceIds: outgoing.flatMap((transition) => transition.evidenceIds),
          suggestedFollowup: `Retry ${state.label} and verify that the flow can recover to an editable or successful state.`,
        })
      );
    }
  }

  for (const transition of automaton.transitions) {
    const fromState = statesById.get(transition.fromStateId);
    const toState = statesById.get(transition.toStateId);
    if (!fromState || !toState) {
      continue;
    }
    if (
      transition.fromStateId === transition.toStateId &&
      transition.observationCount >= minTransitionObservations
    ) {
      anomalies.push(
        createAnomaly({
          type: 'same-state-loop',
          severity: 'medium',
          confidence: Math.min(0.9, 0.4 + transition.observationCount * 0.1),
          summary: `${transition.action.label} repeatedly returned to ${fromState.label}.`,
          stateIds: [fromState.id],
          transitionIds: [transition.id],
          evidenceIds: transition.evidenceIds,
          suggestedFollowup: `Replay ${transition.action.label} from ${fromState.label} and inspect why the workflow fails to advance.`,
        })
      );
    }
    if (
      destructiveTransitionConfirmationRequired &&
      transition.action.destructive &&
      toState.kind !== 'confirmation' &&
      transition.outcome === 'success'
    ) {
      anomalies.push(
        createAnomaly({
          type: 'missing-confirmation',
          severity: 'high',
          confidence: Math.min(0.9, 0.45 + transition.observationCount * 0.08),
          summary: `Destructive action ${transition.action.label} moved from ${fromState.label} to ${toState.label} without an observed confirmation step.`,
          stateIds: [fromState.id, toState.id],
          transitionIds: [transition.id],
          evidenceIds: transition.evidenceIds,
          suggestedFollowup: `Replay ${transition.action.label} and verify whether the UI should require explicit confirmation.`,
        })
      );
    }
    if (
      transition.outcome === 'success' &&
      transition.apiEndpointRefs?.some((ref) => /\[(4xx|5xx)\]/.test(ref))
    ) {
      anomalies.push(
        createAnomaly({
          type: 'ui-api-disagreement',
          severity: 'high',
          confidence: 0.7,
          summary: `${transition.action.label} looked successful in the UI, but related API traffic contained failing responses.`,
          stateIds: [fromState.id, toState.id],
          transitionIds: [transition.id],
          evidenceIds: transition.evidenceIds,
          suggestedFollowup: `Replay ${transition.action.label} and compare the UI outcome with the underlying API responses.`,
        })
      );
    }
    if (
      (transition.outcome === 'blocked' || transition.outcome === 'server-error') &&
      transition.apiEndpointRefs?.some((ref) => /\[2xx\]/.test(ref)) &&
      hasMutatingApiRef(transition)
    ) {
      anomalies.push(
        createAnomaly({
          type: 'ui-api-disagreement',
          severity: 'high',
          confidence: 0.75,
          summary: `${transition.action.label} looked blocked in the UI even though a mutating API request succeeded.`,
          stateIds: [fromState.id, toState.id],
          transitionIds: [transition.id],
          evidenceIds: transition.evidenceIds,
          suggestedFollowup: `Replay ${transition.action.label} and verify whether server state changed despite the blocked UI outcome.`,
        })
      );
    }
    if (transition.confidence < lowConfidenceThreshold && transition.observationCount > 0) {
      anomalies.push(
        createAnomaly({
          type: 'unexplored-high-value-transition',
          severity: 'low',
          confidence: 1 - transition.confidence,
          summary: `${transition.action.label} from ${fromState.label} remains low confidence and needs more observations.`,
          stateIds: [fromState.id, toState.id],
          transitionIds: [transition.id],
          evidenceIds: transition.evidenceIds,
          suggestedFollowup: `Probe ${transition.action.label} again to raise confidence in the observed workflow path.`,
        })
      );
    }
  }

  for (const groupedTransitions of transitionsByAction.values()) {
    if (groupedTransitions.length < 2) {
      continue;
    }
    const totalObservations = groupedTransitions.reduce(
      (sum, transition) => sum + transition.observationCount,
      0
    );
    const destinations = new Set(
      groupedTransitions.map((transition) => `${transition.toStateId}:${transition.outcome}`)
    );
    if (destinations.size < 2 || totalObservations < minTransitionObservations) {
      continue;
    }
    const dominantObservations = Math.max(
      ...groupedTransitions.map((transition) => transition.observationCount)
    );
    const divergence = 1 - dominantObservations / totalObservations;
    if (divergence < nondeterminismThreshold) {
      continue;
    }
    const first = groupedTransitions[0];
    const fromState = statesById.get(first.fromStateId);
    anomalies.push(
      createAnomaly({
        type: 'nondeterministic-transition',
        severity: 'medium',
        confidence: Math.min(0.95, 0.45 + divergence),
        summary: `${first.action.label} from ${fromState?.label ?? first.fromStateId} led to multiple materially different outcomes.`,
        stateIds: [first.fromStateId],
        transitionIds: groupedTransitions.map((transition) => transition.id),
        evidenceIds: groupedTransitions.flatMap((transition) => transition.evidenceIds),
        suggestedFollowup: `Replay ${first.action.label} multiple times and compare the divergent outcomes.`,
      })
    );
  }

  if (comparison && authProfile && comparison.roleDifferences.length > 0) {
    for (const difference of comparison.roleDifferences) {
      anomalies.push(
        createAnomaly({
          type: 'cross-role-privilege-leak',
          severity: 'high',
          confidence: 0.6,
          summary: `${authProfile} diverged from prior role observations: ${difference}`,
          stateIds: [],
          transitionIds: [],
          evidenceIds: [],
          suggestedFollowup: `Re-run the affected flow under ${authProfile} and compare it with the other role's behavior.`,
        })
      );
    }
  }

  return anomalies;
}
