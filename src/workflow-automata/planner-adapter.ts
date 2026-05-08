// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineContext } from '../engine/context.js';
import type { FrontierItem } from '../types.js';
import { compareWorkflowAutomata, finalizeAutomaton, mineWorkflowAutomaton } from './miner.js';
import {
  listPeerWorkflowAutomata,
  loadPreviousWorkflowAutomaton,
  persistWorkflowAutomatonSnapshot,
} from './persistence.js';
import { renderWorkflowAutomatonMermaid } from './render-mermaid.js';
import type { WorkflowAutomaton, WorkflowFollowupCandidate } from './types.js';

function workerTypeForStateKind(
  kind: WorkflowAutomaton['states'][number]['kind']
): WorkflowFollowupCandidate['workerType'] {
  switch (kind) {
    case 'form':
    case 'wizard-step':
    case 'modal':
      return 'form';
    case 'list':
    case 'detail':
    case 'confirmation':
    case 'success':
      return 'crud';
    case 'error':
      return 'form';
    default:
      return 'navigation';
  }
}

export function generateWorkflowFollowups(
  automaton: WorkflowAutomaton,
  priorityBoost: number,
  lowConfidenceThreshold: number
): WorkflowFollowupCandidate[] {
  const candidates: WorkflowFollowupCandidate[] = [];
  for (const anomaly of automaton.anomalies) {
    const primaryState = automaton.states.find((state) => state.id === anomaly.stateIds[0]);
    if (!primaryState) {
      continue;
    }
    candidates.push({
      type:
        anomaly.type === 'nondeterministic-transition'
          ? 'probe-uncertain-transition'
          : anomaly.type === 'cross-role-privilege-leak'
            ? 'cross-role-compare'
            : 'verify-anomaly',
      nodeId: primaryState.sourceNodeIds[0],
      workerType: workerTypeForStateKind(primaryState.kind),
      objective: anomaly.suggestedFollowup ?? `Verify workflow anomaly: ${anomaly.summary}`,
      reason: anomaly.summary,
      priorityBoost,
      dedupeKey: `${anomaly.type}:${primaryState.id}:${anomaly.transitionIds.join(',')}`,
      relatedWorkflowStateIds: anomaly.stateIds,
      relatedWorkflowTransitionIds: anomaly.transitionIds,
      relatedAnomalyIds: [anomaly.id],
    });
  }

  for (const transition of automaton.transitions.filter(
    (candidate) => candidate.confidence < lowConfidenceThreshold
  )) {
    const state = automaton.states.find((candidate) => candidate.id === transition.fromStateId);
    if (!state) {
      continue;
    }
    candidates.push({
      type: 'replay-critical-path',
      nodeId: state.sourceNodeIds[0],
      workerType: workerTypeForStateKind(state.kind),
      objective: `Replay ${transition.action.label} from ${state.label} to confirm the workflow outcome.`,
      reason: `Low-confidence workflow transition (${transition.confidence.toFixed(2)})`,
      priorityBoost,
      dedupeKey: `transition:${transition.fromStateId}:${transition.action.normalizedLabel}:${transition.toStateId}`,
      relatedWorkflowStateIds: [transition.fromStateId, transition.toStateId],
      relatedWorkflowTransitionIds: [transition.id],
      relatedAnomalyIds: [],
    });
  }

  return candidates;
}

function toFrontierItem(
  ctx: EngineContext,
  candidate: WorkflowFollowupCandidate
): FrontierItem | undefined {
  if (!candidate.nodeId) {
    return undefined;
  }
  const followup = ctx.planner.routeFollowup(
    {
      type: candidate.workerType,
      reason: candidate.objective,
    },
    candidate.nodeId
  );
  followup.priority = Math.min(1, followup.priority + candidate.priorityBoost);
  followup.reason = candidate.reason;
  return followup;
}

function mineCurrentAutomaton(ctx: EngineContext): WorkflowAutomaton | undefined {
  const workflowConfig = ctx.config.experimental?.workflowAutomata;
  if (!workflowConfig?.enabled || ctx.graph.nodeCount() === 0) {
    return undefined;
  }
  const previous = loadPreviousWorkflowAutomaton(ctx.config.output.dir, ctx.activeAuthProfile);
  const peers = listPeerWorkflowAutomata(ctx.config.output.dir, ctx.activeAuthProfile);
  const mineOptions = {
    nodes: ctx.graph.getAllNodes(),
    edges: ctx.graph.getAllEdges(),
    ledger: ctx.runLedger,
    targetUrl: ctx.config.targetUrl,
    runId: ctx.outputDir,
    authProfile: ctx.activeAuthProfile,
    includeAuthProfile: workflowConfig.includeAuthProfile,
    includeApiSignals: workflowConfig.includeApiSignals,
    includeModalState: workflowConfig.includeModalState,
    includeFormValidity: workflowConfig.includeFormValidity,
    redactValues: workflowConfig.redactValues,
    maxStates: workflowConfig.maxStates,
    maxTransitions: workflowConfig.maxTransitions,
    minTransitionObservations: workflowConfig.minTransitionObservations,
    nondeterminismThreshold: workflowConfig.nondeterminismThreshold,
    lowConfidenceThreshold: workflowConfig.lowConfidenceThreshold,
    destructiveTransitionConfirmationRequired:
      workflowConfig.destructiveTransitionConfirmationRequired,
  } as const;
  const provisional = mineWorkflowAutomaton(mineOptions);
  const comparison = compareWorkflowAutomata(provisional, previous, peers);
  // Re-finalize with comparison data without re-mining states/transitions
  const current = finalizeAutomaton(provisional, { ...mineOptions, comparison });
  ctx.workflowAutomata = ctx.workflowAutomata ?? {
    generatedFollowups: 0,
    generatedFollowupKeys: new Set<string>(),
  };
  ctx.workflowAutomata.current = current;
  ctx.workflowAutomata.comparison = comparison;
  return current;
}

const WORKFLOW_AUTOMATA_MINE_NODE_THRESHOLD = 5;

export function updateWorkflowAutomataRuntime(ctx: EngineContext): void {
  const workflowConfig = ctx.config.experimental?.workflowAutomata;
  if (!workflowConfig?.enabled) {
    return;
  }
  // Gate: only re-mine if the graph has grown enough since the last mining pass.
  const nodeCount = ctx.graph.nodeCount();
  const lastMinedNodeCount =
    ctx.workflowAutomata?.lastMinedNodeCount ?? -WORKFLOW_AUTOMATA_MINE_NODE_THRESHOLD;
  if (nodeCount > 0 && nodeCount < lastMinedNodeCount + WORKFLOW_AUTOMATA_MINE_NODE_THRESHOLD) {
    return;
  }
  try {
    const automaton = mineCurrentAutomaton(ctx);
    if (ctx.workflowAutomata) {
      ctx.workflowAutomata.lastMinedNodeCount = nodeCount;
    }
    if (!automaton || !workflowConfig.generateFollowups) {
      return;
    }
    const runtime = ctx.workflowAutomata;
    if (!runtime) {
      return;
    }
    const remainingSlots = workflowConfig.maxFollowupsPerRun - runtime.generatedFollowups;
    if (remainingSlots <= 0) {
      return;
    }
    const frontierItems = generateWorkflowFollowups(
      automaton,
      workflowConfig.priorityBoost,
      workflowConfig.lowConfidenceThreshold
    )
      .filter((candidate) => !runtime.generatedFollowupKeys.has(candidate.dedupeKey))
      .slice(0, remainingSlots)
      .map((candidate) => {
        runtime.generatedFollowupKeys.add(candidate.dedupeKey);
        return toFrontierItem(ctx, candidate);
      })
      .filter((item): item is FrontierItem => Boolean(item));
    if (frontierItems.length > 0) {
      runtime.generatedFollowups += frontierItems.length;
      ctx.frontier.enqueueMany(frontierItems);
    }
  } catch (error) {
    ctx.logger?.warn('Workflow automata mining failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function finalizeWorkflowAutomata(ctx: EngineContext): void {
  const workflowConfig = ctx.config.experimental?.workflowAutomata;
  if (!workflowConfig?.enabled) {
    return;
  }
  try {
    const automaton = mineCurrentAutomaton(ctx);
    if (!automaton) {
      return;
    }
    if (workflowConfig.outputJson) {
      writeFileSync(
        join(ctx.outputDir, 'workflow-automata.json'),
        JSON.stringify(automaton, null, 2),
        'utf-8'
      );
    }
    if (workflowConfig.outputMermaid) {
      writeFileSync(
        join(ctx.outputDir, 'workflow-automata.mmd'),
        renderWorkflowAutomatonMermaid(automaton),
        'utf-8'
      );
    }
    if (workflowConfig.persistAcrossRuns) {
      persistWorkflowAutomatonSnapshot(ctx.config.output.dir, automaton);
    }
  } catch (error) {
    ctx.logger?.warn('Workflow automata finalization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
