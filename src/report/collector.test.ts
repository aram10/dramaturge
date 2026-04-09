// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { collectFindings, buildRunResult } from './collector.js';
import type { AreaResult, RawFinding, BlindSpot } from '../types.js';

function makeAreaResult(name: string, findings: RawFinding[]): AreaResult {
  return {
    name,
    steps: 1,
    findings,
    screenshots: new Map(),
    evidence: [],
    coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
    pageType: 'unknown',
    status: 'explored',
  };
}

function makeFinding(
  severity: RawFinding['severity'],
  category: RawFinding['category'],
  title: string
): RawFinding {
  return {
    ref: `fid-${title.toLowerCase().replace(/\s+/g, '-')}-${severity.toLowerCase()}`,
    severity,
    category,
    title,
    stepsToReproduce: ['step 1'],
    expected: 'ok',
    actual: 'not ok',
  };
}

describe('collectFindings', () => {
  it('sorts findings by severity (Critical > Major > Minor > Trivial)', () => {
    const area = makeAreaResult('test', [
      makeFinding('Minor', 'Bug', 'minor bug'),
      makeFinding('Critical', 'Bug', 'critical bug'),
      makeFinding('Trivial', 'UX Concern', 'trivial ux'),
      makeFinding('Major', 'Bug', 'major bug'),
    ]);

    const result = collectFindings([area]);
    expect(result.map((f) => f.severity)).toEqual(['Critical', 'Major', 'Minor', 'Trivial']);
  });

  it('groups findings with same title and severity across areas', () => {
    const area1 = makeAreaResult('page A', [makeFinding('Major', 'Bug', 'Shared error message')]);
    const area2 = makeAreaResult('page B', [makeFinding('Major', 'Bug', 'Shared error message')]);
    const area3 = makeAreaResult('page C', [
      makeFinding('Minor', 'Bug', 'Shared error message'), // different severity — kept
    ]);

    const result = collectFindings([area1, area2, area3]);
    expect(result).toHaveLength(2);
    expect(result[0].severity).toBe('Major');
    expect(result[1].severity).toBe('Minor');
    expect(result[0].occurrenceCount).toBe(2);
    expect(result[0].impactedAreas).toEqual(['page A', 'page B']);
    expect(result[0].occurrences.map((occurrence) => occurrence.area)).toEqual([
      'page A',
      'page B',
    ]);
  });

  it('re-numbers IDs after sorting', () => {
    const area = makeAreaResult('test', [
      makeFinding('Minor', 'Bug', 'minor'),
      makeFinding('Critical', 'Accessibility Issue', 'critical a11y'),
    ]);

    const result = collectFindings([area]);
    // Critical comes first, so A11Y-001, then BUG-002
    expect(result[0].id).toBe('A11Y-001');
    expect(result[1].id).toBe('BUG-002');
  });

  it('returns empty array for no findings', () => {
    expect(collectFindings([])).toEqual([]);
  });

  it('preserves finding metadata and repro artifacts', () => {
    const area = makeAreaResult('test', [
      {
        ...makeFinding('Major', 'Bug', 'Metadata is preserved'),
        meta: {
          source: 'agent',
          confidence: 'medium',
          repro: {
            stateId: 'node-1',
            route: 'https://example.com/manage/knowledge-bases',
            objective: 'Validate knowledge base creation',
            breadcrumbs: ['click create button -> worked'],
            evidenceIds: ['ev-1'],
          },
        },
      },
    ]);

    const result = collectFindings([area]);
    expect(result[0].meta).toMatchObject({
      source: 'agent',
      confidence: 'medium',
      repro: {
        objective: 'Validate knowledge base creation',
        evidenceIds: ['ev-1'],
      },
    });
  });

  it('uses a richer grouping key than severity and title alone', () => {
    const area1 = makeAreaResult('page A', [
      {
        ...makeFinding('Major', 'Bug', 'Shared error message'),
        expected: 'Dialog opens',
        actual: 'Nothing happens',
      },
    ]);
    const area2 = makeAreaResult('page B', [
      {
        ...makeFinding('Major', 'Bug', 'Shared error message'),
        expected: 'Toast appears',
        actual: 'Spinner never finishes',
      },
    ]);

    const result = collectFindings([area1, area2]);

    expect(result).toHaveLength(2);
    expect(result.every((finding) => finding.occurrenceCount === 1)).toBe(true);
  });
});

describe('buildRunResult', () => {
  it('includes blind spots in the result', () => {
    const blindSpots: BlindSpot[] = [
      { summary: 'Unreachable modal', reason: 'state-unreachable', severity: 'medium' },
    ];
    const result = buildRunResult('https://example.com', new Date(), [], [], false, blindSpots);
    expect(result.blindSpots).toHaveLength(1);
    expect(result.blindSpots[0].summary).toBe('Unreachable modal');
  });

  it('includes stateGraphMermaid when provided', () => {
    const result = buildRunResult(
      'https://example.com',
      new Date(),
      [],
      [],
      false,
      [],
      'graph TD\n  A --> B'
    );
    expect(result.stateGraphMermaid).toBe('graph TD\n  A --> B');
  });

  it('includes runConfig when provided', () => {
    const result = buildRunResult('https://example.com', new Date(), [], [], false, [], undefined, {
      appDescription: 'Test app',
      models: { planner: 'claude-sonnet', worker: 'claude-haiku' },
      concurrency: 2,
      budget: { timeLimitSeconds: 900, maxStepsPerTask: 40, maxStateNodes: 50 },
      checkpointInterval: 5,
      autoCaptureEnabled: true,
      llmPlannerEnabled: false,
      memoryEnabled: true,
      visualRegressionEnabled: true,
      warmStartEnabled: true,
    });
    expect(result.runConfig?.concurrency).toBe(2);
    expect(result.runConfig?.llmPlannerEnabled).toBe(false);
  });
});
