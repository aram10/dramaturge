import { validateJsonSchema } from "./ajv.js";
import type {
  NormalizedOperationSpec,
  NormalizedSpecArtifact,
} from "./types.js";
import { buildOperationKey } from "./validators.js";

export interface ContractIndex {
  operations: NormalizedOperationSpec[];
  operationsByKey: Record<string, NormalizedOperationSpec>;
}

function isDynamicSegment(segment: string): boolean {
  return (
    /^\[[^\]]+\]$/.test(segment) ||
    /^\{[^}]+\}$/.test(segment) ||
    /^:[^/]+$/.test(segment)
  );
}

function routeMatches(candidateRoute: string, observedRoute: string): boolean {
  const candidateSegments = candidateRoute.split("/").filter(Boolean);
  const observedSegments = observedRoute.split("/").filter(Boolean);

  if (candidateSegments.length !== observedSegments.length) {
    return false;
  }

  return candidateSegments.every((segment, index) => {
    if (isDynamicSegment(segment)) {
      return observedSegments[index].length > 0;
    }
    return segment === observedSegments[index];
  });
}

export function createContractIndex(artifacts: NormalizedSpecArtifact[]): ContractIndex {
  const operationsByKey: Record<string, NormalizedOperationSpec> = {};

  for (const artifact of artifacts) {
    for (const operation of Object.values(artifact.operations)) {
      operationsByKey[buildOperationKey(operation.method, operation.route)] = operation;
    }
  }

  return {
    operations: Object.values(operationsByKey),
    operationsByKey,
  };
}

export function matchContractOperation(
  index: ContractIndex,
  method: string,
  route: string
): NormalizedOperationSpec | undefined {
  const normalizedMethod = method.toUpperCase();
  const exact = index.operationsByKey[buildOperationKey(normalizedMethod, route)];
  if (exact) {
    return exact;
  }

  return index.operations.find(
    (operation) =>
      operation.method === normalizedMethod && routeMatches(operation.route, route)
  );
}

export function matchContractOperationsForRoute(
  index: ContractIndex,
  route: string
): NormalizedOperationSpec[] {
  return index.operations.filter((operation) => routeMatches(operation.route, route));
}

export function summarizeContractIndex(index: ContractIndex, limit = 4): string[] {
  return index.operations.slice(0, limit).map((operation) => {
    const parts = [
      `${operation.method} ${operation.route}`,
      `statuses ${Object.keys(operation.responses).join(", ") || "none"}`,
      operation.requestBody?.required ? "request body required" : undefined,
      operation.authRequired ? "requires auth" : undefined,
    ].filter(Boolean);

    return `${parts[0]} (${parts.slice(1).join("; ")})`;
  });
}

export function validateOperationResponse(
  index: ContractIndex,
  method: string,
  route: string,
  status: number,
  body: unknown
): { ok: boolean; statusAllowed: boolean; errors: string[]; operation?: NormalizedOperationSpec } {
  const operation = matchContractOperation(index, method, route);
  if (!operation) {
    return {
      ok: true,
      statusAllowed: false,
      errors: [],
    };
  }

  const responseSpec = operation.responses[String(status)];
  const statusAllowed = Boolean(responseSpec);
  if (!statusAllowed) {
    return {
      ok: false,
      statusAllowed: false,
      errors: [`Unexpected status ${status} for ${operation.method} ${operation.route}`],
      operation,
    };
  }

  const validation = validateJsonSchema(responseSpec.schema, body);
  return {
    ok: validation.ok,
    statusAllowed: true,
    errors: validation.errors,
    operation,
  };
}
