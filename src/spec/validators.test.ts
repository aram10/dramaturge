import { describe, it, expect } from 'vitest';
import { buildOperationKey, getOperationSpec } from './validators.js';
import type { NormalizedOperationSpec, NormalizedSpecArtifact } from './types.js';

function makeOperation(overrides: Partial<NormalizedOperationSpec> = {}): NormalizedOperationSpec {
  return {
    id: 'op-1',
    method: 'get',
    route: '/users',
    source: 'openapi',
    responses: {},
    queryParams: [],
    pathParams: [],
    validationSchemas: [],
    ...overrides,
  };
}

function makeArtifact(
  operations: Record<string, NormalizedOperationSpec> = {}
): NormalizedSpecArtifact {
  return {
    routes: Object.values(operations).map((op) => op.route),
    operations,
  };
}

describe('buildOperationKey', () => {
  it('uppercases the method and combines with route', () => {
    expect(buildOperationKey('get', '/users')).toBe('GET /users');
  });

  it('handles already-uppercased methods', () => {
    expect(buildOperationKey('POST', '/items')).toBe('POST /items');
  });

  it('handles mixed-case methods', () => {
    expect(buildOperationKey('pAtCh', '/orders/123')).toBe('PATCH /orders/123');
  });
});

describe('getOperationSpec', () => {
  it('finds an existing operation by method and route', () => {
    const op = makeOperation({ method: 'get', route: '/users' });
    const artifact = makeArtifact({ 'GET /users': op });

    const result = getOperationSpec(artifact, 'get', '/users');
    expect(result).toBe(op);
  });

  it('returns undefined for a missing operation', () => {
    const artifact = makeArtifact({});

    const result = getOperationSpec(artifact, 'delete', '/missing');
    expect(result).toBeUndefined();
  });

  it('matches case-insensitively on the method', () => {
    const op = makeOperation({ method: 'post', route: '/items' });
    const artifact = makeArtifact({ 'POST /items': op });

    expect(getOperationSpec(artifact, 'post', '/items')).toBe(op);
    expect(getOperationSpec(artifact, 'POST', '/items')).toBe(op);
  });
});
