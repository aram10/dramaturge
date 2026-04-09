// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { NormalizedOperationSpec, NormalizedSpecArtifact } from './types.js';

export function buildOperationKey(method: string, route: string): string {
  return `${method.toUpperCase()} ${route}`;
}

export function getOperationSpec(
  artifact: NormalizedSpecArtifact,
  method: string,
  route: string
): NormalizedOperationSpec | undefined {
  return artifact.operations[buildOperationKey(method, route)];
}
