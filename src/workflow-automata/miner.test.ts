// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExplorationLedger, StateEdge, StateNode } from '../types.js';
import { generateWorkflowFollowups } from './planner-adapter.js';
import { compareWorkflowAutomata, mineWorkflowAutomaton } from './miner.js';

function makeNode(overrides: Partial<StateNode> = {}): StateNode {
  return {
    id: 'node-1',
    url: 'https://example.com/orders/123/edit',
    title: 'Edit order',
    fingerprint: {
      normalizedPath: '/orders/123/edit',
      signature: {
        pathname: '/orders/123/edit',
        query: [],
        uiMarkers: ['form', 'input[name=name]', 'invalid'],
      },
      title: 'Edit order',
      heading: 'Edit order',
      dialogTitles: [],
      hash: 'hash-1',
    },
    pageType: 'form',
    depth: 1,
    firstSeenAt: '2026-05-08T21:00:00.000Z',
    controlsDiscovered: ['save', 'delete'],
    controlsExercised: ['save'],
    tags: [],
    riskScore: 0.4,
    timesVisited: 2,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<StateEdge> = {}): StateEdge {
  return {
    id: 'edge-1',
    fromNodeId: 'node-1',
    toNodeId: 'node-2',
    actionLabel: 'Click Save',
    navigationHint: {
      url: 'https://example.com/orders/123',
      actionDescription: 'Save order',
    },
    outcome: 'success',
    timestamp: '2026-05-08T21:00:05.000Z',
    ...overrides,
  };
}

function makeLedger(events: ExplorationLedger['events']): ExplorationLedger {
  return {
    version: 1,
    events,
  };
}

describe('workflow automata mining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mines abstract states, transitions, and anomalies from observed traces', () => {
    const nodes = [
      makeNode(),
      makeNode({
        id: 'node-2',
        url: 'https://example.com/orders/123',
        title: 'Order saved',
        fingerprint: {
          normalizedPath: '/orders/123',
          signature: {
            pathname: '/orders/123',
            query: [],
            uiMarkers: ['detail'],
          },
          title: 'Order saved',
          heading: 'Order saved',
          dialogTitles: [],
          hash: 'hash-2',
        },
        pageType: 'detail',
        timesVisited: 1,
      }),
    ];
    const edges = [makeEdge()];
    const ledger = makeLedger([
      {
        id: 'le-1',
        kind: 'action',
        timestamp: '2026-05-08T21:00:04.000Z',
        stateId: 'node-1',
        actionId: 'act-1',
        action: {
          id: 'act-1',
          kind: 'click',
          summary: 'click save',
          source: 'worker-tool',
          status: 'worked',
          timestamp: '2026-05-08T21:00:04.000Z',
          selector: 'button[type=submit]',
        },
        source: 'action-recorder',
      },
      {
        id: 'le-2',
        kind: 'network',
        timestamp: '2026-05-08T21:00:04.500Z',
        stateId: 'node-1',
        requestId: 'req-1',
        endpoint: {
          route: '/api/orders/123',
          methods: ['POST'],
          statuses: [500],
          failures: [],
        },
      },
    ]);

    const automaton = mineWorkflowAutomaton({
      nodes,
      edges,
      ledger,
      targetUrl: 'https://example.com',
      authProfile: 'standard-user',
      includeAuthProfile: true,
      includeApiSignals: true,
      redactValues: true,
      maxStates: 50,
      maxTransitions: 50,
      minTransitionObservations: 1,
      nondeterminismThreshold: 0.25,
      lowConfidenceThreshold: 0.6,
      destructiveTransitionConfirmationRequired: true,
    });

    expect(automaton.states).toHaveLength(2);
    expect(automaton.states[0].routeFamily).toBe('/orders/:id/edit');
    expect(automaton.transitions).toHaveLength(1);
    expect(automaton.transitions[0].apiEndpointRefs).toContain('POST /api/orders/123 [5xx]');
    expect(automaton.anomalies.some((anomaly) => anomaly.type === 'ui-api-disagreement')).toBe(
      true
    );
  });

  it('compares automata across runs and derives follow-up candidates', () => {
    const current = mineWorkflowAutomaton({
      nodes: [makeNode()],
      edges: [
        makeEdge({
          id: 'edge-loop',
          toNodeId: 'node-1',
          outcome: 'same-state',
          actionLabel: 'Click Next',
        }),
      ],
      ledger: makeLedger([
        {
          id: 'le-1',
          kind: 'action',
          timestamp: '2026-05-08T21:00:04.000Z',
          stateId: 'node-1',
          actionId: 'act-1',
          action: {
            id: 'act-1',
            kind: 'click',
            summary: 'click next',
            source: 'worker-tool',
            status: 'worked',
            timestamp: '2026-05-08T21:00:04.000Z',
          },
          source: 'action-recorder',
        },
      ]),
      targetUrl: 'https://example.com',
      authProfile: 'standard-user',
      includeAuthProfile: true,
      includeApiSignals: true,
      redactValues: true,
      maxStates: 50,
      maxTransitions: 50,
      minTransitionObservations: 1,
      nondeterminismThreshold: 0.25,
      lowConfidenceThreshold: 0.6,
      destructiveTransitionConfirmationRequired: true,
    });
    const previous = mineWorkflowAutomaton({
      nodes: [
        makeNode({
          title: 'Review order',
          fingerprint: {
            normalizedPath: '/orders/123/review',
            signature: {
              pathname: '/orders/123/review',
              query: [],
              uiMarkers: ['form'],
            },
            title: 'Review order',
            heading: 'Review order',
            dialogTitles: [],
            hash: 'hash-review',
          },
        }),
      ],
      edges: [],
      targetUrl: 'https://example.com',
      authProfile: 'admin',
      includeAuthProfile: true,
      includeApiSignals: true,
      redactValues: true,
      maxStates: 50,
      maxTransitions: 50,
      minTransitionObservations: 1,
      nondeterminismThreshold: 0.25,
      lowConfidenceThreshold: 0.6,
      destructiveTransitionConfirmationRequired: true,
    });

    const comparison = compareWorkflowAutomata(current, undefined, [previous]);

    expect(comparison.peerProfiles).toContain('admin');
    expect(comparison.roleDifferences.length).toBeGreaterThanOrEqual(0);

    const followups = generateWorkflowFollowups(current, 0.2);
    expect(followups.length).toBeGreaterThan(0);
    expect(followups[0].priorityBoost).toBe(0.2);
  });
});
