import type { EvalCaseResult } from './types.js';

export function defineEvalFixtures<T extends EvalCaseResult[]>(fixtures: T): T {
  return fixtures;
}
