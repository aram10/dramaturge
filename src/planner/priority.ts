// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { StateNode, WorkerType } from '../types.js';
import type { PlannerMemorySignals } from '../memory/types.js';
import type { DiffContext } from '../diff/types.js';
import { isNodeAffectedByDiff } from '../diff/diff-hints.js';
import {
  PRIORITY_WEIGHTS,
  REVISIT_PENALTY_DIVISOR,
  MEMORY_SIGNAL_BOOST,
  ADVERSARIAL_WORKER_PENALTY,
  DEFAULT_DIFF_PRIORITY_BOOST,
} from '../constants.js';

export interface PriorityContext {
  /** Set of worker types already dispatched for this node. */
  visitedWorkerTypes: Set<WorkerType>;
  memory?: PlannerMemorySignals;
  /** Diff context for diff-aware priority boosting. */
  diffContext?: DiffContext;
  /** Priority boost for nodes matching changed areas (0-1). */
  diffPriorityBoost?: number;
  /** URL of the node being scored — used for diff matching. */
  nodeUrl?: string;
}

export function computePriority(
  node: StateNode,
  workerType: WorkerType,
  ctx: PriorityContext
): number {
  const weights = PRIORITY_WEIGHTS;

  // Novelty: fraction of controls not yet exercised
  const unseenRatio =
    node.controlsDiscovered.length > 0
      ? 1 - node.controlsExercised.length / node.controlsDiscovered.length
      : 1.0;

  // Risk: from the planner's LLM assessment (0-1)
  const risk = node.riskScore;

  // Coverage gap: has this worker type already run on this node?
  const coverageGap = ctx.visitedWorkerTypes.has(workerType) ? 0 : 1;

  // Revisit penalty: diminishing returns from re-visiting
  const revisitPenalty = Math.min(node.timesVisited / REVISIT_PENALTY_DIVISOR, 1);
  const historicalBoost = ctx.memory?.hasNavigationHints ? MEMORY_SIGNAL_BOOST : 0;
  const flakyBoost = ctx.memory?.hasFlakyPageNotes ? MEMORY_SIGNAL_BOOST : 0;
  const suppressionPenalty = ctx.memory?.hasSuppressedFindings ? MEMORY_SIGNAL_BOOST : 0;

  const adversarialPenalty = workerType === 'adversarial' ? ADVERSARIAL_WORKER_PENALTY : 0;

  const diffBoost =
    ctx.diffContext && ctx.nodeUrl && isNodeAffectedByDiff(ctx.nodeUrl, ctx.diffContext)
      ? (ctx.diffPriorityBoost ?? DEFAULT_DIFF_PRIORITY_BOOST)
      : 0;

  const apiGap = workerType === 'api' && !ctx.memory?.hasApiHints ? 1 : 0;
  const diffApiGap =
    workerType === 'api' &&
    ctx.diffContext &&
    (ctx.diffContext.affectedApiEndpoints.length ?? 0) > 0 &&
    !ctx.memory?.hasApiHints
      ? 1
      : 0;

  return Math.max(
    0,
    weights.novelty * unseenRatio +
      weights.risk * risk +
      weights.coverageGap * coverageGap -
      weights.revisitPenalty * revisitPenalty +
      weights.apiGap * apiGap +
      weights.diffApiGap * diffApiGap +
      historicalBoost +
      flakyBoost -
      suppressionPenalty -
      adversarialPenalty +
      diffBoost
  );
}
