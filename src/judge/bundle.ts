import { shortId } from '../constants.js';
import type { Evidence, ReplayableAction } from '../types.js';
import type { Observation, TraceBundle } from './types.js';

export function buildTraceBundle(
  observation: Observation,
  evidence: Evidence[],
  actions: ReplayableAction[]
): TraceBundle {
  const evidenceIds = evidence
    .filter((item) => observation.evidenceIds.includes(item.id))
    .map((item) => item.id);
  const actionIds = actions
    .filter((action) => observation.actionIds.includes(action.id))
    .map((action) => action.id);

  return {
    id: `tb-${shortId()}`,
    observationId: observation.id,
    evidenceIds,
    actionIds,
    summary: [
      `evidence=${evidenceIds.join(', ') || 'none'}`,
      `actions=${actionIds.join(', ') || 'none'}`,
    ],
  };
}
