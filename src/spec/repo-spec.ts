// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { ApiEndpointHint, RepoHints } from '../adaptation/types.js';
import { addOperation, createEmptyNormalizedSpec } from './normalized-spec.js';
import type {
  NormalizedOperationSpec,
  NormalizedRequestBodySpec,
  NormalizedSpecArtifact,
} from './types.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function buildRequestBody(
  endpoint: ApiEndpointHint,
  method: string
): NormalizedRequestBodySpec | undefined {
  if (!MUTATING_METHODS.has(method)) {
    return undefined;
  }

  const schemaName = endpoint.validationSchemas?.[0];
  return {
    required: true,
    schemaName,
  };
}

function buildOperation(endpoint: ApiEndpointHint, method: string): NormalizedOperationSpec {
  return {
    id: `${method.toUpperCase()} ${endpoint.route}`,
    method: method.toUpperCase(),
    route: endpoint.route,
    source: 'repo',
    authRequired: endpoint.authRequired,
    requestBody: buildRequestBody(endpoint, method.toUpperCase()),
    responses: Object.fromEntries(
      endpoint.statuses.map((status) => [
        String(status),
        {
          status: String(status),
        },
      ])
    ),
    queryParams: [],
    pathParams: [],
    validationSchemas: [...(endpoint.validationSchemas ?? [])],
  };
}

export function buildRepoSpec(repoHints: RepoHints): NormalizedSpecArtifact {
  const artifact = createEmptyNormalizedSpec();
  artifact.routes = [
    ...new Set([...repoHints.routes, ...repoHints.apiEndpoints.map((endpoint) => endpoint.route)]),
  ].sort();

  for (const endpoint of repoHints.apiEndpoints) {
    for (const method of endpoint.methods) {
      addOperation(artifact, buildOperation(endpoint, method));
    }
  }

  return artifact;
}
