import { describe, expect, it } from 'vitest';
import {
  createContractIndex,
  matchContractOperation,
  summarizeContractIndex,
  validateOperationResponse,
} from './contract-index.js';
import { buildOpenApiSpec } from './openapi-spec.js';

describe('createContractIndex', () => {
  it('matches operations by exact route and validates response schemas', () => {
    const index = createContractIndex([
      buildOpenApiSpec({
        openapi: '3.1.0',
        info: {
          title: 'Widgets API',
          version: '1.0.0',
        },
        paths: {
          '/api/widgets': {
            post: {
              operationId: 'createWidget',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['name'],
                      properties: {
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
              responses: {
                '201': {
                  description: 'Created',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        required: ['id'],
                        properties: {
                          id: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    expect(matchContractOperation(index, 'POST', '/api/widgets')).toMatchObject({
      id: 'createWidget',
      route: '/api/widgets',
    });

    expect(
      validateOperationResponse(index, 'POST', '/api/widgets', 201, { bad: true })
    ).toMatchObject({
      ok: false,
      statusAllowed: true,
    });

    expect(summarizeContractIndex(index)).toContain(
      'POST /api/widgets (statuses 201; request body required)'
    );
  });

  it('matches parameterized routes from repo-derived operations', () => {
    const index = createContractIndex([
      {
        routes: ['/api/items/[id]'],
        operations: {
          'GET /api/items/[id]': {
            id: 'GET /api/items/[id]',
            method: 'GET',
            route: '/api/items/[id]',
            source: 'repo',
            responses: {
              '200': { status: '200' },
            },
            queryParams: [],
            pathParams: [],
            validationSchemas: [],
          },
        },
      },
    ]);

    expect(matchContractOperation(index, 'GET', '/api/items/42')).toMatchObject({
      route: '/api/items/[id]',
    });
  });
});
