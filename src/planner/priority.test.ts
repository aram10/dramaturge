// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { computePriority, type PriorityContext } from './priority.js';
import type { StateNode } from '../types.js';

function makeNode(overrides: Partial<StateNode> = {}): StateNode {
  return {
    id: 'node-test',
    fingerprint: {
      normalizedPath: '/test',
      signature: {
        pathname: '/test',
        query: [],
        uiMarkers: [],
      },
      title: 'Test',
      heading: 'Test',
      dialogTitles: [],
      hash: 'testhash',
    },
    pageType: 'form',
    depth: 0,
    firstSeenAt: new Date().toISOString(),
    controlsDiscovered: [],
    controlsExercised: [],
    tags: [],
    riskScore: 0,
    timesVisited: 0,
    ...overrides,
  };
}

describe('computePriority', () => {
  const emptyCtx: PriorityContext = {
    visitedWorkerTypes: new Set(),
  };

  it('gives maximum priority to novel, unvisited nodes', () => {
    const node = makeNode();
    const p = computePriority(node, 'form', emptyCtx);
    // novelty=1.0*0.3=0.3, risk=0*0.2=0, coverageGap=1*0.3=0.3, revisit=0
    // total = 0.3 + 0 + 0.3 - 0 = 0.6
    expect(p).toBeCloseTo(0.6);
  });

  it('includes risk score', () => {
    const node = makeNode({ riskScore: 1.0 });
    const p = computePriority(node, 'form', emptyCtx);
    // novelty=0.3, risk=0.2, coverageGap=0.3, revisit=0
    expect(p).toBeCloseTo(0.8);
  });

  it('penalizes revisited nodes', () => {
    const node = makeNode({ timesVisited: 3 });
    const p = computePriority(node, 'form', emptyCtx);
    // novelty=0.3, risk=0, coverageGap=0.3, revisit=min(3/3,1)*0.2=0.2
    expect(p).toBeCloseTo(0.4);
  });

  it('reduces coverage gap when worker type already dispatched', () => {
    const node = makeNode();
    const ctx: PriorityContext = {
      visitedWorkerTypes: new Set(['form']),
    };
    const p = computePriority(node, 'form', ctx);
    // novelty=0.3, risk=0, coverageGap=0, revisit=0
    expect(p).toBeCloseTo(0.3);
  });

  it('reduces novelty when controls are exercised', () => {
    const node = makeNode({
      controlsDiscovered: ['a', 'b', 'c', 'd'],
      controlsExercised: ['a', 'b'],
    });
    const p = computePriority(node, 'navigation', emptyCtx);
    // unseenRatio = 1 - 2/4 = 0.5
    // novelty=0.5*0.3=0.15, risk=0, coverageGap=0.3, revisit=0
    expect(p).toBeCloseTo(0.45);
  });

  it('all controls exercised zeroes novelty', () => {
    const node = makeNode({
      controlsDiscovered: ['a', 'b'],
      controlsExercised: ['a', 'b'],
    });
    const p = computePriority(node, 'form', emptyCtx);
    // novelty=0*0.3=0, risk=0, coverageGap=0.3, revisit=0
    expect(p).toBeCloseTo(0.3);
  });

  it('boosts historically flaky or navigation-rich nodes', () => {
    const node = makeNode();
    const baseline = computePriority(node, 'navigation', emptyCtx);
    const boosted = computePriority(node, 'navigation', {
      visitedWorkerTypes: new Set(),
      memory: {
        hasFlakyPageNotes: true,
        hasNavigationHints: true,
        hasSuppressedFindings: false,
      },
    });

    expect(boosted).toBeGreaterThan(baseline);
  });

  it('slightly penalizes nodes whose prior findings were suppressed', () => {
    const node = makeNode();
    const baseline = computePriority(node, 'form', emptyCtx);
    const suppressed = computePriority(node, 'form', {
      visitedWorkerTypes: new Set(),
      memory: {
        hasFlakyPageNotes: false,
        hasNavigationHints: false,
        hasSuppressedFindings: true,
      },
    });

    expect(suppressed).toBeLessThan(baseline);
  });

  it('boosts priority when node URL matches diff-affected route', () => {
    const node = makeNode({ url: 'https://app.com/dashboard' });
    const baseline = computePriority(node, 'navigation', emptyCtx);
    const boosted = computePriority(node, 'navigation', {
      visitedWorkerTypes: new Set(),
      diffContext: {
        baseRef: 'origin/main',
        changedFiles: [],
        affectedRoutes: ['/dashboard'],
        affectedApiEndpoints: [],
        affectedRouteFamilies: [],
      },
      diffPriorityBoost: 0.3,
      nodeUrl: node.url,
    });

    expect(boosted).toBeGreaterThan(baseline);
    expect(boosted - baseline).toBeCloseTo(0.3);
  });

  it('does not boost when node URL is outside diff scope', () => {
    const node = makeNode({ url: 'https://app.com/about' });
    const baseline = computePriority(node, 'navigation', emptyCtx);
    const notBoosted = computePriority(node, 'navigation', {
      visitedWorkerTypes: new Set(),
      diffContext: {
        baseRef: 'origin/main',
        changedFiles: [],
        affectedRoutes: ['/dashboard'],
        affectedApiEndpoints: [],
        affectedRouteFamilies: [],
      },
      diffPriorityBoost: 0.3,
      nodeUrl: node.url,
    });

    expect(notBoosted).toBeCloseTo(baseline);
  });
});
