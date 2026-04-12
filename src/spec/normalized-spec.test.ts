import { describe, it, expect } from 'vitest';
import { createEmptyNormalizedSpec, addOperation } from './normalized-spec.js';
import type { NormalizedOperationSpec } from './types.js';

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

describe('createEmptyNormalizedSpec', () => {
  it('returns a spec with empty routes and operations', () => {
    const spec = createEmptyNormalizedSpec();

    expect(spec).toEqual({ routes: [], operations: {} });
  });

  it('returns a new object on each call', () => {
    const a = createEmptyNormalizedSpec();
    const b = createEmptyNormalizedSpec();

    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('addOperation', () => {
  it('adds a single operation and its route', () => {
    const spec = createEmptyNormalizedSpec();
    const op = makeOperation({ method: 'get', route: '/users' });

    const result = addOperation(spec, op);

    expect(result.routes).toEqual(['/users']);
    expect(result.operations['GET /users']).toBe(op);
  });

  it('maintains sorted unique routes', () => {
    const spec = createEmptyNormalizedSpec();
    const opB = makeOperation({ id: 'op-b', method: 'get', route: '/zebras' });
    const opA = makeOperation({ id: 'op-a', method: 'post', route: '/animals' });
    const opC = makeOperation({ id: 'op-c', method: 'delete', route: '/animals' });

    addOperation(spec, opB);
    addOperation(spec, opA);
    addOperation(spec, opC);

    expect(spec.routes).toEqual(['/animals', '/zebras']);
  });

  it('overwrites a duplicate operation key', () => {
    const spec = createEmptyNormalizedSpec();
    const original = makeOperation({ id: 'v1', method: 'get', route: '/users' });
    const updated = makeOperation({
      id: 'v2',
      method: 'get',
      route: '/users',
      authRequired: true,
    });

    addOperation(spec, original);
    addOperation(spec, updated);

    expect(spec.operations['GET /users']).toBe(updated);
    expect(spec.routes).toEqual(['/users']);
  });

  it('returns the same artifact reference', () => {
    const spec = createEmptyNormalizedSpec();
    const op = makeOperation();

    const result = addOperation(spec, op);

    expect(result).toBe(spec);
  });
});
