// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { EvalCaseResult } from './types.js';

export function defineEvalFixtures<T extends EvalCaseResult[]>(fixtures: T): T {
  return fixtures;
}
