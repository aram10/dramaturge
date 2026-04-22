// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { classifyFindings } from './cross-run-classification.js';
import { buildFindingGroupKey } from './collector.js';
import type { Finding } from '../types.js';
import type { HistoricalFindingRecord, HistoricalFlakyPageRecord } from '../memory/types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = {
    id: 'BUG-001',
    ref: 'fid-1',
    category: 'Bug',
    severity: 'Major',
    area: 'Dashboard',
    title: 'Button does nothing',
    stepsToReproduce: ['Open page', 'Click button'],
    expected: 'Dialog opens',
    actual: 'Nothing happens',
    occurrenceCount: 1,
    impactedAreas: ['Dashboard'],
    occurrences: [
      {
        area: 'Dashboard',
        route: 'https://example.com/dash',
        evidenceIds: [],
        ref: 'fid-1',
      },
    ],
    ...overrides,
  };
  return base;
}

function signatureFor(finding: Finding): string {
  return buildFindingGroupKey(finding);
}

function makeRecord(
  finding: Finding,
  overrides: Partial<HistoricalFindingRecord> = {}
): HistoricalFindingRecord {
  return {
    signature: signatureFor(finding),
    title: finding.title,
    category: finding.category,
    severity: finding.severity,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-02-01T00:00:00.000Z',
    runCount: 2,
    occurrenceCount: 2,
    recentRoutes: ['/dash'],
    suppressed: false,
    ...overrides,
  };
}

describe('classifyFindings', () => {
  it('marks findings as new when memory history is empty', () => {
    const finding = makeFinding();
    const result = classifyFindings([finding], {});

    expect(result.summary).toEqual({ new: 1, recurring: 0, resolved: 0, flaky: 0, suppressed: 0 });
    expect(result.byFindingId[finding.id].status).toBe('new');
    expect(result.resolved).toEqual([]);
  });

  it('marks findings as recurring when signature already exists in history', () => {
    const finding = makeFinding();
    const record = makeRecord(finding);
    const result = classifyFindings([finding], { [record.signature]: record });

    expect(result.summary.recurring).toBe(1);
    expect(result.byFindingId[finding.id].status).toBe('recurring');
    expect(result.byFindingId[finding.id].firstSeenAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.byFindingId[finding.id].runCount).toBe(2);
  });

  it('marks findings as suppressed when history record is suppressed', () => {
    const finding = makeFinding();
    const record = makeRecord(finding, { suppressed: true, dismissalReason: 'false positive' });
    const result = classifyFindings([finding], { [record.signature]: record });

    expect(result.summary.suppressed).toBe(1);
    expect(result.byFindingId[finding.id].status).toBe('suppressed');
    expect(result.byFindingId[finding.id].dismissalReason).toBe('false positive');
  });

  it('marks findings as flaky when their route matches a flaky page', () => {
    const finding = makeFinding();
    const flakyPages: HistoricalFlakyPageRecord[] = [
      {
        key: 'k1',
        route: '/dash',
        note: 'intermittent',
        source: 'visual-regression',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-02-01T00:00:00.000Z',
        count: 3,
      },
    ];
    const result = classifyFindings([finding], {}, flakyPages);

    expect(result.summary.flaky).toBe(1);
    expect(result.byFindingId[finding.id].status).toBe('flaky');
  });

  it('suppressed status wins over flaky', () => {
    const finding = makeFinding();
    const record = makeRecord(finding, { suppressed: true });
    const flakyPages: HistoricalFlakyPageRecord[] = [
      {
        key: 'k1',
        route: '/dash',
        note: 'intermittent',
        source: 'manual',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-02-01T00:00:00.000Z',
        count: 1,
      },
    ];
    const result = classifyFindings([finding], { [record.signature]: record }, flakyPages);

    expect(result.byFindingId[finding.id].status).toBe('suppressed');
  });

  it('collects resolved findings from prior runs not present in the current set', () => {
    const currentFinding = makeFinding();
    const goneFinding = makeFinding({ title: 'Old finding that resolved' });
    const goneRecord = makeRecord(goneFinding, {
      firstSeenAt: '2025-12-01T00:00:00.000Z',
      lastSeenAt: '2026-03-01T00:00:00.000Z',
      runCount: 5,
    });

    const result = classifyFindings([currentFinding], { [goneRecord.signature]: goneRecord });

    expect(result.summary.resolved).toBe(1);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].title).toBe('Old finding that resolved');
    expect(result.resolved[0].runCount).toBe(5);
  });

  it('does not count suppressed prior findings as resolved', () => {
    const currentFinding = makeFinding();
    const suppressedFinding = makeFinding({ title: 'Suppressed and gone' });
    const suppressedRecord = makeRecord(suppressedFinding, { suppressed: true });

    const result = classifyFindings([currentFinding], {
      [suppressedRecord.signature]: suppressedRecord,
    });

    expect(result.summary.resolved).toBe(0);
    expect(result.resolved).toEqual([]);
  });

  it('does not count dismissed prior findings as resolved', () => {
    const currentFinding = makeFinding();
    const dismissedFinding = makeFinding({ title: 'Dismissed and gone' });
    const dismissedRecord = makeRecord(dismissedFinding, {
      dismissedAt: '2026-03-15T00:00:00.000Z',
      suppressed: false,
    });

    const result = classifyFindings([currentFinding], {
      [dismissedRecord.signature]: dismissedRecord,
    });

    expect(result.summary.resolved).toBe(0);
    expect(result.resolved).toEqual([]);
  });

  it('skips resolved classification when includeResolved is false', () => {
    const currentFinding = makeFinding();
    const goneFinding = makeFinding({ title: 'Not revisited yet' });
    const goneRecord = makeRecord(goneFinding);

    const result = classifyFindings([currentFinding], { [goneRecord.signature]: goneRecord }, [], {
      includeResolved: false,
    });

    expect(result.summary.resolved).toBe(0);
    expect(result.resolved).toEqual([]);
  });
});
