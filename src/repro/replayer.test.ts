// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import type { FindingReplayManifest } from './manifest.js';
import { buildStaticReplayResult, evaluateReplayConfirmation } from './replayer.js';

function makeManifest(overrides: Partial<FindingReplayManifest> = {}): FindingReplayManifest {
  return {
    schemaVersion: 1,
    finding: {
      id: 'BUG-0001',
      signature: '["Bug","Major","Submit fails","ok","bad"]',
      category: 'Bug',
      severity: 'Major',
      title: 'Submit fails',
      expected: 'ok',
      actual: 'bad',
      evidenceTypes: ['console-error'],
    },
    origin: {
      runStartedAt: '2026-05-20T18:00:00.000Z',
      targetUrl: 'https://example.com',
      route: '/checkout',
    },
    replay: {
      actions: [
        {
          id: 'act-1',
          kind: 'click',
          summary: 'Click submit',
          source: 'page',
          status: 'recorded',
          timestamp: '2026-05-20T18:00:01.000Z',
          selector: 'button',
        },
      ],
      breadcrumbs: ['checkout'],
      objective: 'Submit checkout',
      maxStepsBudget: 1,
    },
    oracles: {
      consoleErrorFragments: ['Cannot read properties of null'],
      networkFailures: [{ urlPattern: '/api/orders', status: 500 }],
    },
    ...overrides,
  };
}

describe('evaluateReplayConfirmation', () => {
  it('returns fixed when replay completes and original oracles are absent', () => {
    const manifest = makeManifest();
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: [],
        networkFailures: [],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('fixed');
    expect(result.confidence).toBe('medium');
    expect(result.replay.actionsCompleted).toBe(1);
  });

  it('returns still_reproducible when an original console error is present', () => {
    const manifest = makeManifest({
      oracles: { consoleErrorFragments: ['Cannot read properties of null'] },
    });
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: ['Cannot read properties of null at checkout.js:12'],
        networkFailures: [],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('still_reproducible');
    expect(result.confidence).toBe('high');
  });

  it('returns still_reproducible when an original network failure is present', () => {
    const manifest = makeManifest({
      oracles: { networkFailures: [{ urlPattern: '/api/orders', status: 500 }] },
    });
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: [],
        networkFailures: [{ url: 'https://example.com/api/orders', status: 500 }],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('still_reproducible');
  });

  it('returns new_related_issue when replay completes with a different failure', () => {
    const manifest = makeManifest();
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: ['Different checkout error'],
        networkFailures: [],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('new_related_issue');
    expect(result.confidence).toBe('low');
  });

  it('does not mark partial oracle matches as fully reproducible', () => {
    const manifest = makeManifest();
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: ['Cannot read properties of null at checkout.js:12'],
        networkFailures: [],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('new_related_issue');
    expect(result.confidence).toBe('medium');
  });

  it('returns changed_surface when visual drift exceeds the threshold', () => {
    const manifest = makeManifest();
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: [],
        networkFailures: [],
        a11yRuleIds: [],
        visualDiffRatio: 0.08,
      })
    );

    expect(result.verdict).toBe('changed_surface');
  });

  it('returns new_related_issue when observed behavior is still broken without oracle failures', () => {
    const manifest = makeManifest({ oracles: {} });
    const result = evaluateReplayConfirmation(manifest, {
      ...buildStaticReplayResult(manifest, {
        consoleErrors: [],
        networkFailures: [],
        a11yRuleIds: [],
      }),
      observedNow: { expected: 'Order is submitted', actual: 'Checkout shows validation error' },
    });

    expect(result.verdict).toBe('new_related_issue');
  });

  it('returns cannot_confirm when the finding has no machine-checkable oracle (#209)', () => {
    const manifest = makeManifest({ oracles: {}, finding: { ...makeManifest().finding } });
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: [],
        networkFailures: [],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('cannot_confirm');
    expect(result.confidence).toBe('low');
  });

  it('returns cannot_confirm when replay stops on a blocked action', () => {
    const manifest = makeManifest({
      replay: {
        actions: [
          {
            id: 'act-1',
            kind: 'click',
            summary: 'Click submit',
            source: 'page',
            status: 'blocked',
            timestamp: '2026-05-20T18:00:01.000Z',
          },
        ],
        breadcrumbs: ['checkout'],
        objective: 'Submit checkout',
        maxStepsBudget: 1,
      },
    });
    const result = evaluateReplayConfirmation(
      manifest,
      buildStaticReplayResult(manifest, {
        consoleErrors: [],
        networkFailures: [],
        a11yRuleIds: [],
      })
    );

    expect(result.verdict).toBe('cannot_confirm');
    expect(result.confidence).toBe('low');
    expect(result.replay.stoppedReason).toBe('Click submit');
  });
});
