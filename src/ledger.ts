// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { shortId } from './constants.js';
import type {
  Evidence,
  ExplorationLedger,
  ExplorationLedgerEvent,
  RawFinding,
  ReplayableAction,
} from './types.js';
import type { ObservedApiEndpoint } from './network/traffic-observer.js';
import type { CostRecord } from './coverage/cost-tracker.js';

export interface LedgerContext {
  areaName?: string;
  stateId?: string;
  taskId?: string;
}

export interface LedgerMergeInput {
  actionRecorderActions: ReplayableAction[];
  stagehandActions?: unknown;
  evidence: Evidence[];
  findings: RawFinding[];
  observedApiEndpoints?: ObservedApiEndpoint[];
  costRecords?: readonly CostRecord[];
  context?: LedgerContext;
}

function ledgerId(prefix: string): string {
  return `${prefix}-${shortId()}`;
}

function inferTimestamp(value: { timestamp?: string } | undefined): string {
  if (value?.timestamp) {
    return value.timestamp;
  }
  return new Date().toISOString();
}

function normalizeStagehandActions(value: unknown): Array<{ summary: string; timestamp?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: Array<{ summary: string; timestamp?: string }> = [];
  for (const item of value) {
    if (typeof item === 'string') {
      normalized.push({ summary: item });
      continue;
    }
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const summary =
      typeof record.summary === 'string'
        ? record.summary
        : typeof record.action === 'string'
          ? record.action
          : typeof record.description === 'string'
            ? record.description
            : undefined;
    if (!summary) {
      continue;
    }
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : undefined;
    normalized.push({ summary, timestamp });
  }

  return normalized;
}

export function createExplorationLedger(events: ExplorationLedgerEvent[] = []): ExplorationLedger {
  return { version: 1, events };
}

function buildActionEvents(
  actions: ReplayableAction[],
  context: LedgerContext | undefined
): ExplorationLedgerEvent[] {
  return actions.map((action) => ({
    id: ledgerId('le'),
    kind: 'action' as const,
    timestamp: inferTimestamp(action),
    areaName: context?.areaName,
    stateId: context?.stateId,
    taskId: context?.taskId,
    actionId: action.id,
    action,
    source: 'action-recorder' as const,
  }));
}

function buildStagehandEvents(
  stagehandActions: Array<{ summary: string; timestamp?: string }>,
  actionRecorderActions: ReplayableAction[],
  context: LedgerContext | undefined
): ExplorationLedgerEvent[] {
  const events: ExplorationLedgerEvent[] = [];
  for (const stagehandAction of stagehandActions) {
    const { summary } = stagehandAction;
    if (actionRecorderActions.find((a) => a.summary === summary)) continue;
    const timestamp = stagehandAction.timestamp ?? new Date().toISOString();
    const actionId = ledgerId('stg');
    events.push({
      id: ledgerId('le'),
      kind: 'action',
      timestamp,
      areaName: context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      actionId,
      action: {
        id: actionId,
        kind: 'open',
        summary,
        source: 'page',
        status: 'recorded',
        timestamp,
      },
      source: 'stagehand',
    });
  }
  return events;
}

function buildEvidenceEvents(
  evidence: Evidence[],
  context: LedgerContext | undefined
): ExplorationLedgerEvent[] {
  return evidence.map((ev) => ({
    id: ledgerId('le'),
    kind: 'evidence' as const,
    timestamp: inferTimestamp(ev),
    areaName: ev.areaName ?? context?.areaName,
    stateId: context?.stateId,
    taskId: context?.taskId,
    evidenceId: ev.id,
    evidence: ev,
  }));
}

function buildFindingEvents(
  findings: RawFinding[],
  context: LedgerContext | undefined
): ExplorationLedgerEvent[] {
  return findings.map((finding) => {
    const findingRef = finding.ref ?? ledgerId('finding');
    const linkedEvidenceIds = finding.evidenceIds ?? finding.meta?.repro?.evidenceIds ?? [];
    const linkedActionIds = finding.meta?.repro?.actionIds ?? [];
    return {
      id: ledgerId('le'),
      kind: 'finding' as const,
      timestamp: new Date().toISOString(),
      areaName: context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      findingRef,
      finding,
      linkedEvidenceIds: linkedEvidenceIds.length > 0 ? linkedEvidenceIds : undefined,
      linkedActionIds: linkedActionIds.length > 0 ? linkedActionIds : undefined,
    };
  });
}

function buildNetworkEvents(
  endpoints: ObservedApiEndpoint[],
  context: LedgerContext | undefined
): ExplorationLedgerEvent[] {
  return endpoints.map((endpoint) => ({
    id: ledgerId('le'),
    kind: 'network' as const,
    timestamp: new Date().toISOString(),
    areaName: context?.areaName,
    stateId: context?.stateId,
    taskId: context?.taskId,
    requestId: ledgerId('req'),
    endpoint,
  }));
}

function buildCostEvents(
  costRecords: readonly CostRecord[],
  context: LedgerContext | undefined
): ExplorationLedgerEvent[] {
  return costRecords.map((record) => ({
    id: ledgerId('le'),
    kind: 'model-usage' as const,
    timestamp: record.timestamp,
    areaName: context?.areaName,
    stateId: context?.stateId,
    taskId: context?.taskId,
    record,
  }));
}

export function mergeLedgerEntries(input: LedgerMergeInput): ExplorationLedger {
  const { context } = input;
  const stagehandActions = normalizeStagehandActions(input.stagehandActions);
  const events: ExplorationLedgerEvent[] = [
    ...buildActionEvents(input.actionRecorderActions, context),
    ...buildStagehandEvents(stagehandActions, input.actionRecorderActions, context),
    ...buildEvidenceEvents(input.evidence, context),
    ...buildFindingEvents(input.findings, context),
    ...buildNetworkEvents(input.observedApiEndpoints ?? [], context),
    ...buildCostEvents(input.costRecords ?? [], context),
  ];
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return createExplorationLedger(sorted);
}

export function appendToLedger(
  ledger: ExplorationLedger | undefined,
  entries: ExplorationLedger
): ExplorationLedger {
  const base = ledger?.events ?? [];
  return createExplorationLedger(
    [...base, ...entries.events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  );
}

export function ledgerSummary(ledger: ExplorationLedger | undefined): {
  total: number;
  actions: number;
  evidence: number;
  network: number;
  findings: number;
  modelUsage: number;
} {
  const events = ledger?.events ?? [];
  let actions = 0;
  let evidence = 0;
  let network = 0;
  let findings = 0;
  let modelUsage = 0;
  for (const event of events) {
    switch (event.kind) {
      case 'action':
        actions++;
        break;
      case 'evidence':
        evidence++;
        break;
      case 'network':
        network++;
        break;
      case 'finding':
        findings++;
        break;
      case 'model-usage':
        modelUsage++;
        break;
    }
  }
  return { total: events.length, actions, evidence, network, findings, modelUsage };
}

export function ledgerHasAction(ledger: ExplorationLedger | undefined, actionId: string): boolean {
  if (!ledger) {
    return false;
  }
  return ledger.events.some((event) => event.kind === 'action' && event.actionId === actionId);
}

export function ledgerHasEvidence(
  ledger: ExplorationLedger | undefined,
  evidenceId: string
): boolean {
  if (!ledger) {
    return false;
  }
  return ledger.events.some(
    (event) => event.kind === 'evidence' && event.evidenceId === evidenceId
  );
}
