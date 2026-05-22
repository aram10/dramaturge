// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { scoreFindingQuality } from './quality-score.js';
import type { Evidence, Finding } from '../types.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'BUG-0001',
    ref: 'finding-1',
    category: 'Bug',
    severity: 'Major',
    area: 'Checkout',
    title: 'Submit fails',
    stepsToReproduce: ['Open checkout', 'Submit form'],
    expected: 'Order should submit',
    actual: 'Submit throws',
    screenshot: 'screenshots/bug.png',
    evidenceIds: ['ev-console'],
    occurrenceCount: 1,
    impactedAreas: ['Checkout'],
    occurrences: [
      {
        area: 'Checkout',
        route: 'https://example.com/checkout',
        evidenceIds: ['ev-console'],
        ref: 'finding-1',
      },
    ],
    meta: {
      source: 'agent',
      confidence: 'high',
      repro: {
        route: 'https://example.com/checkout',
        objective: 'Reproduce submit failure',
        breadcrumbs: ['Open checkout'],
        actionIds: ['act-1'],
        evidenceIds: ['ev-console'],
      },
    },
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-console',
    type: 'console-error',
    summary: 'Cannot read properties of null',
    timestamp: '2026-05-20T18:00:00.000Z',
    relatedFindingIds: ['finding-1'],
    ...overrides,
  };
}

describe('scoreFindingQuality', () => {
  it('scores a strong replayable finding as promotable', () => {
    const score = scoreFindingQuality({
      finding: makeFinding(),
      evidence: [makeEvidence()],
      confirmationVerdict: 'fixed',
    });

    expect(score.total).toBe(95);
    expect(score.promotable).toBe(true);
    expect(score.components).toMatchObject({
      hasUrl: true,
      hasReproActions: true,
      hasExpectedActual: true,
      hasScreenshot: true,
      hasNetworkOrConsole: true,
      confidence: 'high',
      confirmationVerdict: 'fixed',
    });
  });

  it('requires replay actions before a finding is promotable', () => {
    const finding = makeFinding({
      meta: {
        source: 'agent',
        confidence: 'high',
        repro: {
          objective: 'Investigate',
          breadcrumbs: [],
          evidenceIds: ['ev-console'],
        },
      },
    });

    const score = scoreFindingQuality({ finding, evidence: [makeEvidence()] });

    expect(score.components.hasReproActions).toBe(false);
    expect(score.total).toBe(60);
    expect(score.promotable).toBe(false);
  });

  it('requires expected and actual to differ before a finding is promotable', () => {
    const finding = makeFinding({ actual: 'Order should submit' });

    const score = scoreFindingQuality({ finding, evidence: [makeEvidence()] });

    expect(score.components.hasExpectedActual).toBe(false);
    expect(score.promotable).toBe(false);
  });

  it('counts accessibility evidence separately from console and network evidence', () => {
    const score = scoreFindingQuality({
      finding: makeFinding({ evidenceIds: ['ev-a11y'], screenshot: undefined }),
      evidence: [makeEvidence({ id: 'ev-a11y', type: 'accessibility-scan' })],
    });

    expect(score.components.hasA11ySource).toBe(true);
    expect(score.components.hasNetworkOrConsole).toBe(false);
    expect(score.components.hasScreenshot).toBe(false);
  });

  it('does not count unrelated evidence when a finding has no evidence links', () => {
    const finding = makeFinding({
      evidenceIds: [],
      meta: {
        source: 'agent',
        confidence: 'high',
        repro: {
          route: 'https://example.com/checkout',
          objective: 'Reproduce submit failure',
          breadcrumbs: [],
          actionIds: ['act-1'],
          evidenceIds: [],
        },
      },
      occurrences: [
        {
          area: 'Checkout',
          route: 'https://example.com/checkout',
          evidenceIds: [],
          ref: 'finding-1',
        },
      ],
      screenshot: undefined,
    });

    const score = scoreFindingQuality({
      finding,
      evidence: [makeEvidence({ id: 'ev-other', relatedFindingIds: ['other-finding'] })],
    });

    expect(score.components.hasNetworkOrConsole).toBe(false);
    expect(score.components.hasScreenshot).toBe(false);
  });

  it('counts evidence related by finding id or ref', () => {
    const finding = makeFinding({ evidenceIds: [], screenshot: undefined });

    const byId = scoreFindingQuality({
      finding,
      evidence: [makeEvidence({ id: 'ev-id', relatedFindingIds: ['BUG-0001'] })],
    });
    const byRef = scoreFindingQuality({
      finding,
      evidence: [makeEvidence({ id: 'ev-ref', relatedFindingIds: ['finding-1'] })],
    });

    expect(byId.components.hasNetworkOrConsole).toBe(true);
    expect(byRef.components.hasNetworkOrConsole).toBe(true);
  });

  it('counts repro route as a URL source when occurrences do not have routes', () => {
    const finding = makeFinding({
      occurrences: [{ area: 'Checkout', evidenceIds: ['ev-console'], ref: 'finding-1' }],
    });

    const score = scoreFindingQuality({ finding, evidence: [makeEvidence()] });

    expect(score.components.hasUrl).toBe(true);
  });
});
