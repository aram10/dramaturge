// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { createHash } from 'node:crypto';
import type {
  ExplorationLedger,
  ExplorationLedgerActionEvent,
  ReplayableAction,
  StateEdge,
  StateNode,
} from '../types.js';
import { redactSensitiveValue } from '../redaction.js';
import type { ObservedApiEndpoint } from '../network/traffic-observer.js';
import { collapseRouteFamily, buildWorkflowStateKey } from './state-abstractor.js';
import type {
  WorkflowAction,
  WorkflowApiSignalSummary,
  WorkflowTraceEvent,
  WorkflowTransitionOutcome,
} from './types.js';

export interface NormalizeWorkflowTraceOptions {
  nodes: StateNode[];
  edges: StateEdge[];
  ledger?: ExplorationLedger;
  authProfile?: string;
  redactValues: boolean;
  includeAuthProfile: boolean;
  includeApiSignals: boolean;
  includeModalState?: boolean;
  includeFormValidity?: boolean;
}

interface LedgerStateIndex {
  actionEvents: ExplorationLedgerActionEvent[];
  evidenceIds: Set<string>;
  findingRefs: Set<string>;
  apiSignals: WorkflowApiSignalSummary[];
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(click|press|tap|open|submit|type|fill|enter|navigate|go to)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectorHash(selector: string | undefined): string | undefined {
  if (!selector) {
    return undefined;
  }
  return createHash('sha256').update(selector).digest('hex').slice(0, 10);
}

function isDestructive(label: string): boolean {
  return /(delete|remove|destroy|purge|drop|reset|clear all|wipe|close account|deactivate)/i.test(
    label
  );
}

function mapActionKind(action: ReplayableAction | { summary: string }): WorkflowAction['kind'] {
  if ('kind' in action) {
    if (action.kind === 'keydown') {
      return 'input';
    }
    if (action.kind === 'discover-edge') {
      return 'navigate';
    }
    if (action.kind === 'screenshot') {
      return 'unknown';
    }
    return action.kind;
  }
  return 'unknown';
}

function mapOutcome(
  status: ReplayableAction['status'] | StateEdge['outcome']
): WorkflowTransitionOutcome {
  switch (status) {
    case 'worked':
    case 'success':
    case 'recorded':
      return 'success';
    case 'blocked':
      return 'blocked';
    case 'error':
      return 'server-error';
    case 'same-state':
      return 'same-state';
    case 'unclear':
    default:
      return 'unknown';
  }
}

function toApiSignals(endpoints: ObservedApiEndpoint[]): WorkflowApiSignalSummary[] {
  return endpoints.flatMap((endpoint) =>
    endpoint.methods.flatMap((method) =>
      endpoint.statuses.map((status) => ({
        route: endpoint.route,
        method,
        status,
        statusClass:
          status >= 500
            ? '5xx'
            : status >= 400
              ? '4xx'
              : status >= 300
                ? '3xx'
                : status >= 200
                  ? '2xx'
                  : '0xx',
      }))
    )
  );
}

function buildStateIndex(
  ledger: ExplorationLedger | undefined,
  includeApiSignals: boolean
): Map<string, LedgerStateIndex> {
  const byState = new Map<string, LedgerStateIndex>();
  for (const event of ledger?.events ?? []) {
    const stateId = event.stateId;
    if (!stateId) {
      continue;
    }
    const current = byState.get(stateId) ?? {
      actionEvents: [],
      evidenceIds: new Set<string>(),
      findingRefs: new Set<string>(),
      apiSignals: [],
    };
    switch (event.kind) {
      case 'action':
        current.actionEvents.push(event);
        break;
      case 'evidence':
        current.evidenceIds.add(event.evidenceId);
        break;
      case 'finding':
        current.findingRefs.add(event.findingRef);
        for (const evidenceId of event.linkedEvidenceIds ?? []) {
          current.evidenceIds.add(evidenceId);
        }
        break;
      case 'network':
        if (includeApiSignals) {
          current.apiSignals.push(...toApiSignals([event.endpoint]));
        }
        break;
      default:
        break;
    }
    byState.set(stateId, current);
  }
  return byState;
}

function createWorkflowAction(action: ReplayableAction, redactValues: boolean): WorkflowAction {
  return {
    kind: mapActionKind(action),
    label: action.value
      ? `${action.summary} ${redactValues ? String(redactSensitiveValue(action.value)) : String(action.value)}`
      : action.summary,
    normalizedLabel: normalizeLabel(action.summary),
    destructive: isDestructive(action.summary),
    selectorHash: selectorHash(action.selector),
  };
}

function scoreActionMatch(actionEvent: ExplorationLedgerActionEvent, edge: StateEdge): number {
  const actionLabel = normalizeLabel(actionEvent.action.summary);
  const edgeLabel = normalizeLabel(edge.actionLabel);
  if (actionLabel === edgeLabel) {
    return 2;
  }
  if (actionLabel.includes(edgeLabel) || edgeLabel.includes(actionLabel)) {
    return 1;
  }
  return 0;
}

function findMatchingActionEvent(
  edge: StateEdge,
  stateIndex: LedgerStateIndex | undefined,
  usedActionIds: Set<string>
): ExplorationLedgerActionEvent | undefined {
  const candidates =
    stateIndex?.actionEvents.filter((event) => !usedActionIds.has(event.actionId)) ?? [];
  let best: ExplorationLedgerActionEvent | undefined;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreActionMatch(candidate, edge);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function normalizeWorkflowTrace(options: NormalizeWorkflowTraceOptions): {
  events: WorkflowTraceEvent[];
  stateKeysByNodeId: Map<string, WorkflowTraceEvent['abstractStateBefore']>;
} {
  const {
    nodes,
    edges,
    ledger,
    authProfile,
    redactValues,
    includeAuthProfile,
    includeApiSignals,
    includeModalState = true,
    includeFormValidity = true,
  } = options;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const stateIndex = buildStateIndex(ledger, includeApiSignals);
  const resolvedAuthProfile = includeAuthProfile ? authProfile : undefined;
  const stateKeysByNodeId = new Map(
    nodes.map((node) => [
      node.id,
      buildWorkflowStateKey(
        node,
        authProfile,
        includeAuthProfile,
        includeModalState,
        includeFormValidity
      ),
    ])
  );
  const usedActionIds = new Set<string>();
  const events: WorkflowTraceEvent[] = [];

  const sortedEdges = [...edges].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  );
  for (const edge of sortedEdges) {
    const fromNode = nodesById.get(edge.fromNodeId);
    if (!fromNode) {
      continue;
    }
    const fromIndex = stateIndex.get(edge.fromNodeId);
    const actionEvent = findMatchingActionEvent(edge, fromIndex, usedActionIds);
    if (actionEvent) {
      usedActionIds.add(actionEvent.actionId);
    }

    events.push({
      timestamp: edge.timestamp,
      sourceNodeId: edge.fromNodeId,
      sourceEdgeId: edge.id,
      sourceActionId: actionEvent?.actionId,
      evidenceIds: [...(fromIndex?.evidenceIds ?? new Set<string>())],
      findingRefs: [...(fromIndex?.findingRefs ?? new Set<string>())],
      abstractStateBefore: stateKeysByNodeId.get(edge.fromNodeId),
      abstractAction: actionEvent
        ? createWorkflowAction(actionEvent.action, redactValues)
        : {
            kind: 'click',
            label: edge.actionLabel,
            normalizedLabel: normalizeLabel(edge.actionLabel),
            destructive: isDestructive(edge.actionLabel),
          },
      abstractStateAfter: stateKeysByNodeId.get(edge.toNodeId),
      outcome: mapOutcome(edge.outcome),
      routeFamily: collapseRouteFamily(fromNode.fingerprint.normalizedPath ?? fromNode.url),
      pageType: fromNode.pageType,
      authProfile: resolvedAuthProfile,
      apiSignals: fromIndex?.apiSignals,
    });
  }

  for (const [stateId, index] of stateIndex.entries()) {
    for (const actionEvent of index.actionEvents) {
      if (usedActionIds.has(actionEvent.actionId)) {
        continue;
      }
      const node = nodesById.get(stateId);
      if (!node) {
        continue;
      }
      events.push({
        timestamp: actionEvent.timestamp,
        sourceNodeId: stateId,
        sourceActionId: actionEvent.actionId,
        evidenceIds: [...index.evidenceIds],
        findingRefs: [...index.findingRefs],
        abstractStateBefore: stateKeysByNodeId.get(stateId),
        abstractAction: createWorkflowAction(actionEvent.action, redactValues),
        abstractStateAfter: stateKeysByNodeId.get(stateId),
        outcome: mapOutcome(actionEvent.action.status),
        routeFamily: collapseRouteFamily(node.fingerprint.normalizedPath ?? node.url),
        pageType: node.pageType,
        authProfile: resolvedAuthProfile,
        apiSignals: index.apiSignals,
      });
    }
  }

  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return { events, stateKeysByNodeId };
}
