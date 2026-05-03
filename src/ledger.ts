// SPDX-License-Identifier: GPL-3.0-only
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

export function mergeLedgerEntries(input: LedgerMergeInput): ExplorationLedger {
  const context = input.context;
  const events: ExplorationLedgerEvent[] = [];

  for (const action of input.actionRecorderActions) {
    events.push({
      id: ledgerId('le'),
      kind: 'action',
      timestamp: inferTimestamp(action),
      areaName: context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      actionId: action.id,
      action,
      source: 'action-recorder',
    });
  }

  const stagehandActions = normalizeStagehandActions(input.stagehandActions);
  for (const stagehandAction of stagehandActions) {
    const summary = stagehandAction.summary;
    const matched = input.actionRecorderActions.find((action) => action.summary === summary);
    if (matched) {
      continue;
    }
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

  for (const ev of input.evidence) {
    events.push({
      id: ledgerId('le'),
      kind: 'evidence',
      timestamp: inferTimestamp(ev),
      areaName: ev.areaName ?? context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      evidenceId: ev.id,
      evidence: ev,
    });
  }

  for (const finding of input.findings) {
    const findingRef = finding.ref ?? ledgerId('finding');
    const linkedEvidenceIds = finding.evidenceIds ?? finding.meta?.repro?.evidenceIds ?? [];
    const linkedActionIds = finding.meta?.repro?.actionIds ?? [];
    events.push({
      id: ledgerId('le'),
      kind: 'finding',
      timestamp: new Date().toISOString(),
      areaName: context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      findingRef,
      finding,
      linkedEvidenceIds: linkedEvidenceIds.length > 0 ? linkedEvidenceIds : undefined,
      linkedActionIds: linkedActionIds.length > 0 ? linkedActionIds : undefined,
    });
  }

  for (const endpoint of input.observedApiEndpoints ?? []) {
    const requestId = ledgerId('req');
    events.push({
      id: ledgerId('le'),
      kind: 'network',
      timestamp: new Date().toISOString(),
      areaName: context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      requestId,
      endpoint,
    });
  }

  for (const record of input.costRecords ?? []) {
    events.push({
      id: ledgerId('le'),
      kind: 'model-usage',
      timestamp: record.timestamp,
      areaName: context?.areaName,
      stateId: context?.stateId,
      taskId: context?.taskId,
      record,
    });
  }

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
