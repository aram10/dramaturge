import type { NormalizedOperationSpec, NormalizedSpecArtifact } from "./types.js";
import { buildOperationKey } from "./validators.js";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function createEmptyNormalizedSpec(): NormalizedSpecArtifact {
  return {
    routes: [],
    operations: {},
  };
}

export function addOperation(
  artifact: NormalizedSpecArtifact,
  operation: NormalizedOperationSpec
): NormalizedSpecArtifact {
  artifact.routes = uniqueSorted([...artifact.routes, operation.route]);
  artifact.operations[buildOperationKey(operation.method, operation.route)] = operation;
  return artifact;
}
