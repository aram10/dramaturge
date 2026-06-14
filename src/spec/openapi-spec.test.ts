// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { buildOpenApiSpec } from './openapi-spec.js';

describe('buildOpenApiSpec', () => {
  it('normalizes OpenAPI operations into the shared contract format', () => {
    const spec = buildOpenApiSpec({
      openapi: '3.1.0',
      info: {
        title: 'Widgets API',
        version: '1.0.0',
      },
      paths: {
        '/api/widgets': {
          post: {
            operationId: 'createWidget',
            security: [{ cookieAuth: [] }],
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
              '400': {
                description: 'Bad Request',
              },
            },
          },
        },
      },
    });

    expect(spec.routes).toContain('/api/widgets');
    expect(spec.operations['POST /api/widgets']).toMatchObject({
      id: 'createWidget',
      method: 'POST',
      route: '/api/widgets',
      source: 'openapi',
      authRequired: true,
      requestBody: {
        required: true,
      },
      responses: {
        '201': expect.objectContaining({
          status: '201',
          description: 'Created',
        }),
        '400': expect.objectContaining({
          status: '400',
          description: 'Bad Request',
        }),
      },
    });
  });
});

describe('buildOpenApiSpec $ref resolution (#210)', () => {
  it('embeds components so local $ref schemas compile and validate', async () => {
    const { validateJsonSchema } = await import('./ajv.js');
    const spec = buildOpenApiSpec({
      openapi: '3.1.0',
      components: {
        schemas: {
          User: {
            type: 'object',
            required: ['id', 'name'],
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
        },
      },
      paths: {
        '/users/{id}': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
        },
      },
    });

    const op = Object.values(spec.operations)[0];
    const schema = op.responses['200'].schema;

    expect(validateJsonSchema(schema, { id: 1, name: 'Ada' })).toEqual({ ok: true, errors: [] });
    const invalid = validateJsonSchema(schema, { id: 'not-an-int' });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });
});

describe('buildOpenApiSpec server base path (#234)', () => {
  it('prefixes routes with the server base path from an absolute URL', () => {
    const spec = buildOpenApiSpec({
      openapi: '3.1.0',
      servers: [{ url: 'https://api.example.com/api/v1' }],
      paths: { '/users': { get: { responses: { '200': { description: 'ok' } } } } },
    });

    expect(spec.routes).toContain('/api/v1/users');
    expect(spec.routes).not.toContain('/users');
  });

  it('supports a relative server base path', () => {
    const spec = buildOpenApiSpec({
      openapi: '3.1.0',
      servers: [{ url: '/api/v2' }],
      paths: { '/widgets': { get: { responses: { '200': { description: 'ok' } } } } },
    });

    expect(spec.routes).toContain('/api/v2/widgets');
  });

  it('leaves routes unchanged when there is no server base path', () => {
    const spec = buildOpenApiSpec({
      openapi: '3.1.0',
      servers: [{ url: 'https://api.example.com' }],
      paths: { '/users': { get: { responses: { '200': { description: 'ok' } } } } },
    });

    expect(spec.routes).toContain('/users');
  });
});
