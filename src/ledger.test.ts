// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import {
  appendToLedger,
  createExplorationLedger,
  ledgerSummary,
  mergeLedgerEntries,
} from './ledger.js';
import type { Evidence, RawFinding, ReplayableAction } from './types.js';

function makeAction(overrides: Partial<ReplayableAction> = {}): ReplayableAction {
  return {
    id: overrides.id ?? 'act-1',
    kind: overrides.kind ?? 'click',
    summary: overrides.summary ?? 'click login',
    source: overrides.source ?? 'page',
    status: overrides.status ?? 'worked',
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00.000Z',
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: overrides.id ?? 'ev-1',
    type: overrides.type ?? 'screenshot',
    summary: overrides.summary ?? 'shot',
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:01.000Z',
    relatedFindingIds: overrides.relatedFindingIds ?? [],
    ...(overrides.path ? { path: overrides.path } : {}),
    ...(overrides.areaName ? { areaName: overrides.areaName } : {}),
  };
}

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ref: overrides.ref ?? 'obs-1',
    category: overrides.category ?? 'Bug',
    severity: overrides.severity ?? 'Major',
    title: overrides.title ?? 'Broken login',
    stepsToReproduce: overrides.stepsToReproduce ?? ['click login'],
    expected: overrides.expected ?? 'Logged in',
    actual: overrides.actual ?? 'Error',
    ...(overrides.evidenceIds ? { evidenceIds: overrides.evidenceIds } : {}),
    ...(overrides.verdict ? { verdict: overrides.verdict } : {}),
    ...(overrides.meta ? { meta: overrides.meta } : {}),
  };
}

describe('ledger', () => {
  it('merges action/evidence/finding into a stable event stream', () => {
    const ledger = mergeLedgerEntries({
      actionRecorderActions: [makeAction()],
      stagehandActions: [{ summary: 'click login' }, { summary: 'type username' }],
      evidence: [makeEvidence()],
      findings: [
        makeFinding({
          evidenceIds: ['ev-1'],
          meta: {
            source: 'agent',
            confidence: 'high',
            repro: { objective: 'x', breadcrumbs: [], evidenceIds: ['ev-1'], actionIds: ['act-1'] },
          },
        }),
      ],
      observedApiEndpoints: [],
      context: { areaName: 'A' },
    });

    const summary = ledgerSummary(ledger);
    expect(summary.actions).toBe(2);
    expect(summary.evidence).toBe(1);
    expect(summary.findings).toBe(1);
    expect(ledger.events[0].timestamp <= ledger.events[ledger.events.length - 1].timestamp).toBe(
      true
    );
  });

  it('appends ledgers deterministically', () => {
    const a = createExplorationLedger([
      {
        id: 'le-1',
        kind: 'action',
        timestamp: '2026-01-01T00:00:00.000Z',
        actionId: 'act-1',
        action: makeAction(),
        source: 'action-recorder',
      },
    ]);
    const b = createExplorationLedger([
      {
        id: 'le-2',
        kind: 'evidence',
        timestamp: '2026-01-01T00:00:01.000Z',
        evidenceId: 'ev-1',
        evidence: makeEvidence(),
      },
    ]);

    const merged = appendToLedger(a, b);
    expect(merged.events).toHaveLength(2);
    expect(merged.events[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(merged.events[1].timestamp).toBe('2026-01-01T00:00:01.000Z');
  });
});
