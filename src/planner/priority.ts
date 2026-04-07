import type { StateNode, WorkerType } from '../types.js';
import type { PlannerMemorySignals } from '../memory/types.js';
import type { DiffContext } from '../diff/types.js';
import { isNodeAffectedByDiff } from '../diff/diff-hints.js';

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
  const weights = {
    novelty: 0.3,
    risk: 0.2,
    coverageGap: 0.3,
    revisitPenalty: 0.2,
  };

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
  const revisitPenalty = Math.min(node.timesVisited / 3, 1);
  const historicalBoost = ctx.memory?.hasNavigationHints ? 0.05 : 0;
  const flakyBoost = ctx.memory?.hasFlakyPageNotes ? 0.05 : 0;
  const suppressionPenalty = ctx.memory?.hasSuppressedFindings ? 0.05 : 0;

  const adversarialPenalty = workerType === 'adversarial' ? 0.2 : 0;

  const diffBoost =
    ctx.diffContext && ctx.nodeUrl && isNodeAffectedByDiff(ctx.nodeUrl, ctx.diffContext)
      ? (ctx.diffPriorityBoost ?? 0.3)
      : 0;

  return Math.max(
    0,
    weights.novelty * unseenRatio +
      weights.risk * risk +
      weights.coverageGap * coverageGap -
      weights.revisitPenalty * revisitPenalty +
      historicalBoost +
      flakyBoost -
      suppressionPenalty -
      adversarialPenalty +
      diffBoost
  );
}
