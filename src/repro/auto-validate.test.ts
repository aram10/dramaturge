// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import type { AreaResult, Evidence, RawFinding, ReplayableAction, RunResult } from '../types.js';
import { buildFindingGroupKey, collectFindings } from '../report/collector.js';
import { validateHighImpactFindings } from './auto-validate.js';
import type { FindingReplayManifest } from './manifest.js';
import {
  buildStaticReplayResult,
  type ManifestReplayResult,
  type ReplayAdapter,
} from './replayer.js';

function makeAction(overrides: Partial<ReplayableAction> = {}): ReplayableAction {
  return {
    id: 'act-1',
    kind: 'click',
    summary: 'Click submit',
    source: 'page',
    status: 'recorded',
    timestamp: '2026-05-20T18:00:00.000Z',
    selector: 'button[type="submit"]',
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    type: 'console-error',
    summary: 'Cannot read properties of null',
    timestamp: '2026-05-20T18:01:00.000Z',
    relatedFindingIds: ['fid-1'],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ref: 'fid-1',
    category: 'Bug',
    severity: 'Major',
    title: 'Submit fails',
    stepsToReproduce: ['Open checkout', 'Click submit'],
    expected: 'Order is submitted',
    actual: 'Console error appears',
    evidenceIds: ['ev-1'],
    meta: {
      source: 'agent',
      confidence: 'high',
      repro: {
        route: '/checkout',
        objective: 'Submit checkout form',
        breadcrumbs: ['checkout', 'submit'],
        actionIds: ['act-1'],
        evidenceIds: ['ev-1'],
      },
    },
    ...overrides,
  };
}

function makeArea(overrides: Partial<AreaResult> = {}): AreaResult {
  return {
    name: 'Checkout',
    url: 'https://example.com/checkout',
    steps: 2,
    findings: [makeFinding()],
    replayableActions: [makeAction()],
    screenshots: new Map(),
    evidence: [makeEvidence()],
    coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
    pageType: 'form',
    status: 'explored',
    ...overrides,
  };
}

function makeRunResult(areaResults: AreaResult[] = [makeArea()]): RunResult {
  return {
    targetUrl: 'https://example.com',
    startTime: new Date('2026-05-20T18:00:00.000Z'),
    endTime: new Date('2026-05-20T18:02:00.000Z'),
    areaResults,
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
  };
}

function adapterReturning(observed: ManifestReplayResult['observed']): ReplayAdapter {
  return {
    replay: (manifest: FindingReplayManifest) =>
      Promise.resolve(buildStaticReplayResult(manifest, observed)),
  };
}

function signatureOf(result: RunResult): string {
  return buildFindingGroupKey(collectFindings(result.areaResults)[0]);
}

describe('validateHighImpactFindings', () => {
  it('marks a finding confirmed when it still reproduces', async () => {
    const result = makeRunResult();
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({
        consoleErrors: ['Cannot read properties of null at checkout.js:12'],
        networkFailures: [],
        a11yRuleIds: [],
      }),
    });

    expect(summary).toMatchObject({ validated: 1, confirmed: 1 });
    const validation = result.replayValidations?.[signatureOf(result)];
    expect(validation?.status).toBe('confirmed');
    expect(validation?.verdict).toBe('still_reproducible');
    expect(validation?.actionsCompleted).toBe(1);
  });

  it('marks a finding unconfirmed when the oracle no longer fails', async () => {
    const result = makeRunResult();
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({
        consoleErrors: [],
        networkFailures: [],
        a11yRuleIds: [],
      }),
    });

    expect(summary).toMatchObject({ validated: 1, unconfirmed: 1 });
    expect(result.replayValidations?.[signatureOf(result)].status).toBe('unconfirmed');
  });

  it('marks a finding flaky when a different failure surfaces', async () => {
    const result = makeRunResult();
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({
        consoleErrors: ['An entirely different runtime error'],
        networkFailures: [],
        a11yRuleIds: [],
      }),
    });

    expect(summary).toMatchObject({ validated: 1, flaky: 1 });
    expect(result.replayValidations?.[signatureOf(result)].status).toBe('flaky');
  });

  it('labels a finding unavailable (not dropped) when no action trace exists', async () => {
    const area = makeArea({
      findings: [
        makeFinding({
          meta: {
            source: 'agent',
            confidence: 'high',
            repro: {
              route: '/checkout',
              objective: 'Submit checkout form',
              breadcrumbs: ['checkout'],
              actionIds: [],
              evidenceIds: ['ev-1'],
            },
          },
        }),
      ],
      replayableActions: [],
    });
    const result = makeRunResult([area]);
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({ consoleErrors: [], networkFailures: [], a11yRuleIds: [] }),
    });

    expect(summary).toMatchObject({ validated: 1, unavailable: 1 });
    const validation = result.replayValidations?.[signatureOf(result)];
    expect(validation?.status).toBe('unavailable');
    expect(validation?.detail).toContain('No replayable action trace');
  });

  it('labels a finding unavailable when the replay adapter throws', async () => {
    const result = makeRunResult();
    const summary = await validateHighImpactFindings(result, {
      adapter: {
        replay: () => Promise.reject(new Error('browser crashed')),
      },
    });

    expect(summary).toMatchObject({ validated: 1, unavailable: 1 });
    const validation = result.replayValidations?.[signatureOf(result)];
    expect(validation?.status).toBe('unavailable');
    expect(validation?.detail).toContain('browser crashed');
  });

  it('only validates high-impact severities', async () => {
    const minor = makeArea({
      name: 'Footer',
      url: 'https://example.com/footer',
      findings: [makeFinding({ severity: 'Minor', title: 'Tiny nit' })],
    });
    const result = makeRunResult([makeArea(), minor]);
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({
        consoleErrors: ['Cannot read properties of null at checkout.js:12'],
        networkFailures: [],
        a11yRuleIds: [],
      }),
    });

    expect(summary.validated).toBe(1);
    expect(Object.keys(result.replayValidations ?? {})).toHaveLength(1);
  });

  it('caps the number of findings validated', async () => {
    const titles = ['Login crash', 'Payment crash', 'Search crash'];
    const areas = titles.map((title, i) =>
      makeArea({
        name: `Area-${i}`,
        url: `https://example.com/area-${i}`,
        findings: [makeFinding({ title, severity: 'Critical' })],
      })
    );
    const result = makeRunResult(areas);
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({ consoleErrors: [], networkFailures: [], a11yRuleIds: [] }),
      maxFindings: 2,
    });

    expect(summary.validated).toBe(2);
  });

  it('returns an empty summary when there are no high-impact findings', async () => {
    const result = makeRunResult([makeArea({ findings: [makeFinding({ severity: 'Minor' })] })]);
    const summary = await validateHighImpactFindings(result, {
      adapter: adapterReturning({ consoleErrors: [], networkFailures: [], a11yRuleIds: [] }),
    });

    expect(summary.validated).toBe(0);
    expect(result.replayValidations).toBeUndefined();
  });
});
