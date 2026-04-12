import { describe, it, expect } from 'vitest';
import type { ObservedApiEndpoint } from '../network/traffic-observer.js';
import type { ContractIndex } from '../spec/contract-index.js';
import type { NormalizedOperationSpec } from '../spec/types.js';
import type { ApiProbeTarget } from './types.js';
import { selectApiProbeTargets } from './correlation.js';

function makeObservedEndpoint(overrides: Partial<ObservedApiEndpoint> = {}): ObservedApiEndpoint {
  return {
    route: '/api/users',
    methods: ['GET'],
    statuses: [200],
    failures: [],
    ...overrides,
  };
}

function makeOperation(overrides: Partial<NormalizedOperationSpec> = {}): NormalizedOperationSpec {
  return {
    id: 'op-1',
    method: 'GET',
    route: '/api/users',
    source: 'openapi',
    responses: {},
    queryParams: [],
    pathParams: [],
    validationSchemas: [],
    ...overrides,
  };
}

function makeContractIndex(operations: NormalizedOperationSpec[]): ContractIndex {
  const operationsByKey: Record<string, NormalizedOperationSpec> = {};
  for (const op of operations) {
    operationsByKey[`${op.method} ${op.route}`] = op;
  }
  return { operations, operationsByKey };
}

describe('selectApiProbeTargets', () => {
  it('returns empty array when no endpoints or contract operations', () => {
    const result = selectApiProbeTargets({
      pageRoute: '/dashboard',
      observedEndpoints: [],
      maxEndpoints: 10,
    });

    expect(result).toEqual([]);
  });

  it('returns empty array when contract index has no operations', () => {
    const result = selectApiProbeTargets({
      pageRoute: '/dashboard',
      observedEndpoints: [],
      contractIndex: makeContractIndex([]),
      maxEndpoints: 10,
    });

    expect(result).toEqual([]);
  });

  it('returns observed endpoints ranked by route overlap with page route', () => {
    const endpoints: ObservedApiEndpoint[] = [
      makeObservedEndpoint({ route: '/api/settings', methods: ['GET'] }),
      makeObservedEndpoint({ route: '/api/users', methods: ['GET'] }),
      makeObservedEndpoint({ route: '/api/users/profile', methods: ['GET'] }),
    ];

    const result = selectApiProbeTargets({
      pageRoute: '/users/profile',
      observedEndpoints: endpoints,
      maxEndpoints: 10,
    });

    expect(result.length).toBe(3);
    // /api/users/profile has 2 overlapping tokens ("users", "profile")
    // /api/users has 1 overlapping token ("users")
    // /api/settings has 0 overlapping tokens
    expect(result[0].route).toBe('/api/users/profile');
    expect(result[1].route).toBe('/api/users');
    expect(result[2].route).toBe('/api/settings');
  });

  it('respects maxEndpoints limit', () => {
    const endpoints: ObservedApiEndpoint[] = [
      makeObservedEndpoint({ route: '/api/a', methods: ['GET'] }),
      makeObservedEndpoint({ route: '/api/b', methods: ['GET'] }),
      makeObservedEndpoint({ route: '/api/c', methods: ['GET'] }),
    ];

    const result = selectApiProbeTargets({
      pageRoute: '/x',
      observedEndpoints: endpoints,
      maxEndpoints: 2,
    });

    expect(result.length).toBe(2);
  });

  it('merges observed and contract-sourced endpoints', () => {
    const endpoints: ObservedApiEndpoint[] = [
      makeObservedEndpoint({ route: '/api/users', methods: ['GET'] }),
    ];

    const contractIndex = makeContractIndex([
      makeOperation({ id: 'op-posts', method: 'GET', route: '/api/users/posts' }),
    ]);

    const result = selectApiProbeTargets({
      pageRoute: '/users',
      observedEndpoints: endpoints,
      contractIndex,
      maxEndpoints: 10,
    });

    expect(result.length).toBe(2);
    const sources = result.map((t) => t.source);
    expect(sources).toContain('observed');
    expect(sources).toContain('contract');
  });

  it('filters out contract-only endpoints with no overlap when observed endpoints exist', () => {
    const endpoints: ObservedApiEndpoint[] = [
      makeObservedEndpoint({ route: '/api/users', methods: ['GET'] }),
    ];

    const contractIndex = makeContractIndex([
      makeOperation({
        id: 'op-unrelated',
        method: 'GET',
        route: '/api/completely-unrelated',
      }),
    ]);

    const result = selectApiProbeTargets({
      pageRoute: '/users',
      observedEndpoints: endpoints,
      contractIndex,
      maxEndpoints: 10,
    });

    const contractTargets = result.filter((t) => t.source === 'contract');
    expect(contractTargets).toEqual([]);
  });

  it('sorts by score descending, then observed before contract, then lexicographically', () => {
    const endpoints: ObservedApiEndpoint[] = [
      makeObservedEndpoint({ route: '/api/items', methods: ['GET'] }),
      makeObservedEndpoint({ route: '/api/items', methods: ['POST'] }),
    ];

    const contractIndex = makeContractIndex([
      makeOperation({ id: 'op-items-get', method: 'GET', route: '/api/items' }),
      makeOperation({ id: 'op-items-delete', method: 'DELETE', route: '/api/items' }),
    ]);

    const result = selectApiProbeTargets({
      pageRoute: '/items',
      observedEndpoints: endpoints,
      contractIndex,
      maxEndpoints: 10,
    });

    // Observed endpoints score higher (observedBoost = 1).
    // Among same-score targets, observed comes before contract.
    // Within same source, lexicographic order by "METHOD route".
    const keys = result.map((t) => `${t.source}:${t.method} ${t.route}`);

    const observedKeys = keys.filter((k) => k.startsWith('observed:'));
    const contractKeys = keys.filter((k) => k.startsWith('contract:'));

    // All observed should come before any contract target
    if (observedKeys.length > 0 && contractKeys.length > 0) {
      const lastObservedIdx = keys.lastIndexOf(observedKeys[observedKeys.length - 1]);
      const firstContractIdx = keys.indexOf(contractKeys[0]);
      expect(lastObservedIdx).toBeLessThan(firstContractIdx);
    }

    // Observed targets should be sorted lexicographically among themselves
    for (let i = 1; i < observedKeys.length; i++) {
      expect(observedKeys[i - 1].localeCompare(observedKeys[i])).toBeLessThanOrEqual(0);
    }
  });
});
