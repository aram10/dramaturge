import { describe, it, expect } from 'vitest';
import {
  createApiProbeDiagnostics,
  recordApiProbeSuccess,
  recordApiProbeFailure,
  formatApiProbeSummary,
  buildApiProbeDiagnosticsEvidence,
} from './diagnostics.js';
import type { ApiProbeDiagnostics } from './diagnostics.js';

function makeDiagnostics(overrides: Partial<ApiProbeDiagnostics> = {}): ApiProbeDiagnostics {
  return {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    recentFailures: [],
    ...overrides,
  };
}

describe('createApiProbeDiagnostics', () => {
  it('creates zeroed counters', () => {
    const diagnostics = createApiProbeDiagnostics();

    expect(diagnostics).toEqual({
      attempted: 0,
      succeeded: 0,
      failed: 0,
      recentFailures: [],
    });
  });
});

describe('recordApiProbeSuccess', () => {
  it('increments succeeded counter', () => {
    const diagnostics = makeDiagnostics();

    recordApiProbeSuccess(diagnostics);
    expect(diagnostics.succeeded).toBe(1);

    recordApiProbeSuccess(diagnostics);
    expect(diagnostics.succeeded).toBe(2);
  });
});

describe('recordApiProbeFailure', () => {
  it('increments failed counter', () => {
    const diagnostics = makeDiagnostics();

    recordApiProbeFailure(diagnostics, 'timeout');
    expect(diagnostics.failed).toBe(1);

    recordApiProbeFailure(diagnostics, 'network error');
    expect(diagnostics.failed).toBe(2);
  });

  it('keeps recent failures capped at 5', () => {
    const diagnostics = makeDiagnostics();

    for (let i = 1; i <= 7; i++) {
      recordApiProbeFailure(diagnostics, `failure-${i}`);
    }

    expect(diagnostics.recentFailures).toHaveLength(5);
    expect(diagnostics.recentFailures).toEqual([
      'failure-3',
      'failure-4',
      'failure-5',
      'failure-6',
      'failure-7',
    ]);
    expect(diagnostics.failed).toBe(7);
  });
});

describe('formatApiProbeSummary', () => {
  it('produces expected summary string', () => {
    const diagnostics = makeDiagnostics({
      attempted: 10,
      succeeded: 8,
      failed: 2,
    });

    const summary = formatApiProbeSummary(5, diagnostics);

    expect(summary).toBe(
      'Completed api task with 5 probe target(s); attempted 10, succeeded 8, failed 2'
    );
  });

  it('handles zero counts', () => {
    const diagnostics = makeDiagnostics();
    const summary = formatApiProbeSummary(0, diagnostics);

    expect(summary).toBe(
      'Completed api task with 0 probe target(s); attempted 0, succeeded 0, failed 0'
    );
  });
});

describe('buildApiProbeDiagnosticsEvidence', () => {
  it('returns undefined when no failures', () => {
    const diagnostics = makeDiagnostics({ attempted: 5, succeeded: 5 });

    const result = buildApiProbeDiagnosticsEvidence('user-api', diagnostics);
    expect(result).toBeUndefined();
  });

  it('returns evidence when failures exist', () => {
    const diagnostics = makeDiagnostics({
      attempted: 3,
      succeeded: 1,
      failed: 2,
      recentFailures: ['timeout on GET /api/users', '500 on POST /api/items'],
    });

    const evidence = buildApiProbeDiagnosticsEvidence('user-api', diagnostics);

    expect(evidence).toBeDefined();
    expect(evidence!.type).toBe('api-contract');
    expect(evidence!.areaName).toBe('user-api');
    expect(evidence!.relatedFindingIds).toEqual([]);
    expect(evidence!.id).toMatch(/^ev-/);
    expect(evidence!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evidence!.summary).toContain('attempted 3');
    expect(evidence!.summary).toContain('succeeded 1');
    expect(evidence!.summary).toContain('failed 2');
  });

  it('includes recent failure messages in the summary', () => {
    const diagnostics = makeDiagnostics({
      attempted: 2,
      succeeded: 0,
      failed: 2,
      recentFailures: ['err-a', 'err-b'],
    });

    const evidence = buildApiProbeDiagnosticsEvidence('test-area', diagnostics);

    expect(evidence).toBeDefined();
    expect(evidence!.summary).toContain('err-a');
    expect(evidence!.summary).toContain('err-b');
  });
});
