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

interface TransitionIndexes {
  transitionsByState: Map<string, WorkflowTransition[]>;
  transitionsByAction: Map<string, WorkflowTransition[]>;
}

interface DetectionContext {
  automaton: WorkflowAutomaton;
  options: DetectWorkflowAnomaliesOptions;
  statesById: Map<string, WorkflowAutomaton['states'][number]>;
  indexes: TransitionIndexes;
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

function buildTransitionIndexes(transitions: WorkflowTransition[]): TransitionIndexes {
  const transitionsByState = new Map<string, WorkflowTransition[]>();
  const transitionsByAction = new Map<string, WorkflowTransition[]>();

  for (const transition of transitions) {
    const outgoing = transitionsByState.get(transition.fromStateId) ?? [];
    outgoing.push(transition);
    transitionsByState.set(transition.fromStateId, outgoing);

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

  return { transitionsByState, transitionsByAction };
}

function detectDeadEndAnomaly(
  ctx: DetectionContext,
  state: WorkflowAutomaton['states'][number]
): WorkflowAnomaly | undefined {
  const outgoing = ctx.indexes.transitionsByState.get(state.id) ?? [];
  if (
    state.observationCount < ctx.options.minTransitionObservations ||
    isTerminalKind(state.kind) ||
    outgoing.length > 0
  ) {
    return undefined;
  }

  return createAnomaly({
    type: 'dead-end',
    severity: 'medium',
    confidence: Math.min(0.9, 0.45 + state.observationCount * 0.1),
    summary: `${state.label} had no observed outgoing transitions after repeated visits.`,
    stateIds: [state.id],
    transitionIds: [],
    evidenceIds: [],
    suggestedFollowup: `Revisit ${state.label} and probe its next-step controls.`,
  });
}

function detectRecoveryPathAnomaly(
  ctx: DetectionContext,
  state: WorkflowAutomaton['states'][number]
): WorkflowAnomaly | undefined {
  const outgoing = ctx.indexes.transitionsByState.get(state.id) ?? [];
  const successfulOutgoing = outgoing.filter((transition) => transition.outcome === 'success');
  if (
    state.kind !== 'error' ||
    state.observationCount < ctx.options.minTransitionObservations ||
    successfulOutgoing.length > 0
  ) {
    return undefined;
  }

  return createAnomaly({
    type: 'missing-recovery-path',
    severity: 'medium',
    confidence: Math.min(0.85, 0.4 + state.observationCount * 0.08),
    summary: `${state.label} showed no successful recovery path after an error or validation state.`,
    stateIds: [state.id],
    transitionIds: outgoing.map((transition) => transition.id),
    evidenceIds: outgoing.flatMap((transition) => transition.evidenceIds),
    suggestedFollowup: `Retry ${state.label} and verify that the flow can recover to an editable or successful state.`,
  });
}

function detectStateAnomalies(ctx: DetectionContext): WorkflowAnomaly[] {
  return ctx.automaton.states.flatMap((state) =>
    [detectDeadEndAnomaly(ctx, state), detectRecoveryPathAnomaly(ctx, state)].filter(
      (value): value is WorkflowAnomaly => Boolean(value)
    )
  );
}

function detectLoopAnomaly(
  transition: WorkflowTransition,
  fromState: WorkflowAutomaton['states'][number]
): WorkflowAnomaly | undefined {
  if (transition.fromStateId !== transition.toStateId || transition.observationCount < 1) {
    return undefined;
  }
  return createAnomaly({
    type: 'same-state-loop',
    severity: 'medium',
    confidence: Math.min(0.9, 0.4 + transition.observationCount * 0.1),
    summary: `${transition.action.label} repeatedly returned to ${fromState.label}.`,
    stateIds: [fromState.id],
    transitionIds: [transition.id],
    evidenceIds: transition.evidenceIds,
    suggestedFollowup: `Replay ${transition.action.label} from ${fromState.label} and inspect why the workflow fails to advance.`,
  });
}

function detectConfirmationAnomaly(
  transition: WorkflowTransition,
  fromState: WorkflowAutomaton['states'][number],
  toState: WorkflowAutomaton['states'][number],
  destructiveTransitionConfirmationRequired: boolean
): WorkflowAnomaly | undefined {
  if (
    !destructiveTransitionConfirmationRequired ||
    !transition.action.destructive ||
    toState.kind === 'confirmation' ||
    transition.outcome !== 'success'
  ) {
    return undefined;
  }

  return createAnomaly({
    type: 'missing-confirmation',
    severity: 'high',
    confidence: Math.min(0.9, 0.45 + transition.observationCount * 0.08),
    summary: `Destructive action ${transition.action.label} moved from ${fromState.label} to ${toState.label} without an observed confirmation step.`,
    stateIds: [fromState.id, toState.id],
    transitionIds: [transition.id],
    evidenceIds: transition.evidenceIds,
    suggestedFollowup: `Replay ${transition.action.label} and verify whether the UI should require explicit confirmation.`,
  });
}

function detectUiApiDisagreementAnomalies(
  transition: WorkflowTransition,
  fromState: WorkflowAutomaton['states'][number],
  toState: WorkflowAutomaton['states'][number]
): WorkflowAnomaly[] {
  const anomalies: WorkflowAnomaly[] = [];
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
  return anomalies;
}

function detectLowConfidenceAnomaly(
  transition: WorkflowTransition,
  fromState: WorkflowAutomaton['states'][number],
  toState: WorkflowAutomaton['states'][number],
  lowConfidenceThreshold: number
): WorkflowAnomaly | undefined {
  if (transition.confidence >= lowConfidenceThreshold || transition.observationCount === 0) {
    return undefined;
  }
  return createAnomaly({
    type: 'unexplored-high-value-transition',
    severity: 'low',
    confidence: 1 - transition.confidence,
    summary: `${transition.action.label} from ${fromState.label} remains low confidence and needs more observations.`,
    stateIds: [fromState.id, toState.id],
    transitionIds: [transition.id],
    evidenceIds: transition.evidenceIds,
    suggestedFollowup: `Probe ${transition.action.label} again to raise confidence in the observed workflow path.`,
  });
}

function detectTransitionAnomalies(ctx: DetectionContext): WorkflowAnomaly[] {
  const anomalies: WorkflowAnomaly[] = [];
  for (const transition of ctx.automaton.transitions) {
    const fromState = ctx.statesById.get(transition.fromStateId);
    const toState = ctx.statesById.get(transition.toStateId);
    if (!fromState || !toState) {
      continue;
    }

    const candidates = [
      detectLoopAnomaly(transition, fromState),
      detectConfirmationAnomaly(
        transition,
        fromState,
        toState,
        ctx.options.destructiveTransitionConfirmationRequired
      ),
      detectLowConfidenceAnomaly(
        transition,
        fromState,
        toState,
        ctx.options.lowConfidenceThreshold
      ),
    ].filter((value): value is WorkflowAnomaly => Boolean(value));
    anomalies.push(...candidates);
    anomalies.push(...detectUiApiDisagreementAnomalies(transition, fromState, toState));
  }
  return anomalies;
}

function detectNondeterminismAnomalies(ctx: DetectionContext): WorkflowAnomaly[] {
  const anomalies: WorkflowAnomaly[] = [];
  for (const groupedTransitions of ctx.indexes.transitionsByAction.values()) {
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
    if (destinations.size < 2 || totalObservations < ctx.options.minTransitionObservations) {
      continue;
    }
    const dominantObservations = Math.max(
      ...groupedTransitions.map((transition) => transition.observationCount)
    );
    const divergence = 1 - dominantObservations / totalObservations;
    if (divergence < ctx.options.nondeterminismThreshold) {
      continue;
    }
    const first = groupedTransitions[0];
    const fromState = ctx.statesById.get(first.fromStateId);
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
  return anomalies;
}

function detectRoleComparisonAnomalies(
  authProfile: string | undefined,
  comparison: WorkflowAutomatonComparison | undefined
): WorkflowAnomaly[] {
  if (!comparison || !authProfile || comparison.roleDifferences.length === 0) {
    return [];
  }
  return comparison.roleDifferences.map((difference) =>
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

export function detectWorkflowAnomalies(
  automaton: WorkflowAutomaton,
  options: DetectWorkflowAnomaliesOptions
): WorkflowAnomaly[] {
  const ctx: DetectionContext = {
    automaton,
    options,
    statesById: new Map(automaton.states.map((state) => [state.id, state])),
    indexes: buildTransitionIndexes(automaton.transitions),
  };

  return [
    ...detectStateAnomalies(ctx),
    ...detectTransitionAnomalies(ctx),
    ...detectNondeterminismAnomalies(ctx),
    ...detectRoleComparisonAnomalies(options.authProfile, options.comparison),
  ];
}
