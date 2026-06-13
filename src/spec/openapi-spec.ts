// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { addOperation, createEmptyNormalizedSpec } from './normalized-spec.js';
import type {
  JsonSchema,
  NormalizedOperationSpec,
  NormalizedResponseSpec,
  NormalizedSpecArtifact,
} from './types.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return value.slice(0, end);
}

function firstContentSchema(
  container: Record<string, unknown> | undefined,
  components?: Record<string, unknown>
): JsonSchema | undefined {
  const content = asObject(container?.content);
  if (!content) {
    return undefined;
  }

  for (const mediaType of Object.values(content)) {
    const entry = asObject(mediaType);
    const schema = asObject(entry?.schema);
    if (schema) {
      return attachComponents(schema, components);
    }
  }

  return undefined;
}

/**
 * Embed the document's `components` under the extracted schema root so local
 * `#/components/schemas/*` references resolve when the schema is compiled in
 * isolation by AJV. Without this, virtually every real-world spec (which uses
 * $ref) throws MissingRefError during validation (#210).
 */
function attachComponents(
  schema: Record<string, unknown>,
  components?: Record<string, unknown>
): JsonSchema {
  if (!components || 'components' in schema) {
    return schema as JsonSchema;
  }
  return { ...schema, components } as JsonSchema;
}

function buildResponses(
  operation: Record<string, unknown>,
  components?: Record<string, unknown>
): Record<string, NormalizedResponseSpec> {
  const responses = asObject(operation.responses) ?? {};
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      const responseObject = asObject(response) ?? {};
      return [
        status,
        {
          status,
          description:
            typeof responseObject.description === 'string' ? responseObject.description : undefined,
          schema: firstContentSchema(responseObject, components),
        },
      ];
    })
  );
}

function buildOperation(
  route: string,
  method: string,
  operation: Record<string, unknown>,
  documentSecurity?: unknown,
  components?: Record<string, unknown>
): NormalizedOperationSpec {
  const requestBody = asObject(operation.requestBody);
  const security = operation.security ?? documentSecurity;

  return {
    id:
      typeof operation.operationId === 'string'
        ? operation.operationId
        : `${method.toUpperCase()} ${route}`,
    method: method.toUpperCase(),
    route,
    source: 'openapi',
    authRequired: Array.isArray(security) ? security.length > 0 : undefined,
    requestBody: requestBody
      ? {
          required: requestBody.required === true,
          schema: firstContentSchema(requestBody, components),
        }
      : undefined,
    responses: buildResponses(operation, components),
    queryParams: [],
    pathParams: [],
    validationSchemas: [],
  };
}

export function buildOpenApiSpec(document: unknown): NormalizedSpecArtifact {
  const artifact = createEmptyNormalizedSpec();
  const parsed = asObject(document);
  const paths = asObject(parsed?.paths) ?? {};
  const documentSecurity = parsed?.security;
  const components = asObject(parsed?.components);
  const basePath = extractServerBasePath(parsed?.servers);

  for (const [route, pathItem] of Object.entries(paths)) {
    const pathObject = asObject(pathItem);
    if (!pathObject) {
      continue;
    }

    // Prefix the declared server base path so normalized routes correlate with
    // observed traffic, e.g. `/users` under server `…/api/v1` → `/api/v1/users`
    // (#234).
    const fullRoute = joinRoute(basePath, route);

    artifact.routes = [...new Set([...artifact.routes, fullRoute])].sort();

    for (const method of HTTP_METHODS) {
      const operation = asObject(pathObject[method]);
      if (!operation) {
        continue;
      }
      addOperation(
        artifact,
        buildOperation(fullRoute, method, operation, documentSecurity, components)
      );
    }
  }

  return artifact;
}

/**
 * Derive the base path from the first `servers[].url`. Absolute URLs contribute
 * only their pathname; relative server URLs are used as-is. Returns '' when no
 * usable base path is present.
 */
function extractServerBasePath(servers: unknown): string {
  if (!Array.isArray(servers) || servers.length === 0) return '';
  const first = asObject(servers[0]);
  const url = typeof first?.url === 'string' ? first.url.trim() : '';
  if (!url) return '';
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Relative server URL (e.g. '/api/v1'): use it directly.
    pathname = url;
  }
  const trimmed = trimTrailingSlashes(pathname);
  if (trimmed === '' || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function joinRoute(basePath: string, route: string): string {
  if (!basePath) return route;
  const left = trimTrailingSlashes(basePath);
  const right = route.startsWith('/') ? route : `/${route}`;
  return `${left}${right}`;
}
