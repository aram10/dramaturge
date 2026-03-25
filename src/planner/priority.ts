import type { StateNode, WorkerType } from "../types.js";

export interface PriorityContext {
  /** Set of worker types already dispatched for this node. */
  visitedWorkerTypes: Set<WorkerType>;
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
      ? 1 -
        node.controlsExercised.length / node.controlsDiscovered.length
      : 1.0;

  // Risk: from the planner's LLM assessment (0-1)
  const risk = node.riskScore;

  // Coverage gap: has this worker type already run on this node?
  const coverageGap = ctx.visitedWorkerTypes.has(workerType) ? 0 : 1;

  // Revisit penalty: diminishing returns from re-visiting
  const revisitPenalty = Math.min(node.timesVisited / 3, 1);

  return (
    weights.novelty * unseenRatio +
    weights.risk * risk +
    weights.coverageGap * coverageGap -
    weights.revisitPenalty * revisitPenalty
  );
}
