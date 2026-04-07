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

function firstContentSchema(
  container: Record<string, unknown> | undefined
): JsonSchema | undefined {
  const content = asObject(container?.content);
  if (!content) {
    return undefined;
  }

  for (const mediaType of Object.values(content)) {
    const entry = asObject(mediaType);
    const schema = asObject(entry?.schema);
    if (schema) {
      return schema;
    }
  }

  return undefined;
}

function buildResponses(
  operation: Record<string, unknown>
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
          schema: firstContentSchema(responseObject),
        },
      ];
    })
  );
}

function buildOperation(
  route: string,
  method: string,
  operation: Record<string, unknown>,
  documentSecurity?: unknown
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
          schema: firstContentSchema(requestBody),
        }
      : undefined,
    responses: buildResponses(operation),
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

  for (const [route, pathItem] of Object.entries(paths)) {
    const pathObject = asObject(pathItem);
    if (!pathObject) {
      continue;
    }

    artifact.routes = [...new Set([...artifact.routes, route])].sort();

    for (const method of HTTP_METHODS) {
      const operation = asObject(pathObject[method]);
      if (!operation) {
        continue;
      }
      addOperation(artifact, buildOperation(route, method, operation, documentSecurity));
    }
  }

  return artifact;
}
