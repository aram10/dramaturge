// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { calculateMetrics, classifyFinding, formatMetrics } from './metrics.js';
import type { Finding } from '../types.js';
import type { BenchmarkApp, FindingClassification } from './types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    category: 'Bug',
    severity: 'Major',
    title: 'Test finding',
    stepsToReproduce: [],
    expected: '',
    actual: '',
    area: 'test',
    occurrenceCount: 1,
    impactedAreas: [],
    occurrences: [],
    meta: {
      source: 'agent',
      confidence: 'high',
    },
    ...overrides,
  };
}

function makeApp(overrides: Partial<BenchmarkApp> = {}): BenchmarkApp {
  return {
    id: 'test-app',
    name: 'Test App',
    url: 'https://test.example.com',
    description: 'Test application',
    configPath: 'test.json',
    knownIssues: [],
    ...overrides,
  };
}

describe('classifyFinding', () => {
  it('matches findings to known issues by category and keywords', () => {
    const app = makeApp({
      knownIssues: [
        {
          id: 'known-1',
          category: 'Accessibility Issue',
          description: 'Missing ARIA labels on buttons',
          severity: 'Minor',
        },
      ],
    });

    const finding = makeFinding({
      category: 'Accessibility Issue',
      title: 'Button elements are missing ARIA labels for screen readers',
    });

    const classification = classifyFinding(finding, app.knownIssues);

    expect(classification.isRealIssue).toBe(true);
    expect(classification.matchesKnownIssue).toBe(true);
    expect(classification.knownIssueId).toBe('known-1');
  });

  it('does not match findings with different categories', () => {
    const app = makeApp({
      knownIssues: [
        {
          id: 'known-1',
          category: 'Bug',
          description: 'Missing ARIA labels',
          severity: 'Minor',
        },
      ],
    });

    const finding = makeFinding({
      category: 'Accessibility Issue',
      title: 'Missing ARIA labels',
    });

    const classification = classifyFinding(finding, app.knownIssues);

    expect(classification.matchesKnownIssue).toBe(false);
  });

  it('considers high confidence findings as real issues even without known match', () => {
    const finding = makeFinding({
      meta: { source: 'agent', confidence: 'high' },
    });

    const classification = classifyFinding(finding, []);

    expect(classification.isRealIssue).toBe(true);
    expect(classification.matchesKnownIssue).toBe(false);
  });
});

describe('calculateMetrics', () => {
  it('calculates precision and recall correctly', () => {
    const app = makeApp({
      knownIssues: [
        { id: 'k1', category: 'Bug', description: 'Known bug', severity: 'Major' },
        { id: 'k2', category: 'Bug', description: 'Another bug', severity: 'Minor' },
      ],
    });

    const findings = [
      makeFinding({ id: 'f1' }),
      makeFinding({ id: 'f2' }),
      makeFinding({ id: 'f3' }),
    ];

    const classifications: FindingClassification[] = [
      {
        finding: findings[0],
        isRealIssue: true,
        matchesKnownIssue: true,
        knownIssueId: 'k1',
      },
      {
        finding: findings[1],
        isRealIssue: true,
        matchesKnownIssue: false,
      },
      {
        finding: findings[2],
        isRealIssue: false,
        matchesKnownIssue: false,
      },
    ];

    const metrics = calculateMetrics(app, findings, classifications, {
      startTime: 0,
      firstFindingTime: 1000,
      endTime: 5000,
    });

    expect(metrics.totalFindings).toBe(3);
    expect(metrics.truePositives).toBe(2);
    expect(metrics.falsePositives).toBe(1);
    expect(metrics.knownIssuesCaught).toBe(1);
    expect(metrics.knownIssuesMissed).toBe(1);
    expect(metrics.precision).toBeCloseTo(2 / 3);
    expect(metrics.recall).toBeCloseTo(1 / 2);
    expect(metrics.timeToFirstFinding).toBe(1000);
    expect(metrics.totalRuntime).toBe(5000);
  });

  it('counts findings by category', () => {
    const app = makeApp();
    const findings = [
      makeFinding({ category: 'Bug' }),
      makeFinding({ category: 'Bug' }),
      makeFinding({ category: 'Accessibility Issue' }),
    ];

    const classifications = findings.map((finding) => ({
      finding,
      isRealIssue: true,
      matchesKnownIssue: false,
    }));

    const metrics = calculateMetrics(app, findings, classifications, {
      startTime: 0,
      endTime: 1000,
    });

    expect(metrics.categoriesFound['Bug']).toBe(2);
    expect(metrics.categoriesFound['Accessibility Issue']).toBe(1);
  });
});

describe('formatMetrics', () => {
  it('formats metrics as readable text', () => {
    const metrics = {
      appId: 'test-app',
      totalFindings: 10,
      truePositives: 8,
      falsePositives: 2,
      knownIssuesCaught: 3,
      knownIssuesMissed: 1,
      precision: 0.8,
      recall: 0.75,
      categoriesFound: {
        Bug: 5,
        'Accessibility Issue': 3,
        'UX Concern': 2,
      } as any,
      timeToFirstFinding: 2500,
      totalRuntime: 30000,
      timestamp: '2026-05-08T12:00:00.000Z',
    };

    const formatted = formatMetrics(metrics);

    expect(formatted).toContain('test-app');
    expect(formatted).toContain('Total findings: 10');
    expect(formatted).toContain('Precision: 80.0%');
    expect(formatted).toContain('Recall: 75.0%');
    expect(formatted).toContain('Bug: 5');
    expect(formatted).toContain('Time to first finding: 2.5s');
    expect(formatted).toContain('Total runtime: 30.0s');
  });
});
