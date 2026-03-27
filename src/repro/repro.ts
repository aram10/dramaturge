import type {
  FindingConfidence,
  FindingMeta,
  FindingSource,
  ReproArtifact,
} from "../types.js";

interface ReproInput {
  stateId?: string;
  route?: string;
  objective: string;
  breadcrumbs?: string[];
  evidenceIds?: string[];
}

interface FindingMetaInput extends ReproInput {
  source: FindingSource;
  confidence: FindingConfidence;
}

export function buildReproArtifact(input: ReproInput): ReproArtifact {
  return {
    stateId: input.stateId,
    route: input.route,
    objective: input.objective,
    breadcrumbs: input.breadcrumbs ?? [],
    evidenceIds: input.evidenceIds ?? [],
  };
}

export function buildFindingMeta(input: FindingMetaInput): FindingMeta {
  return {
    source: input.source,
    confidence: input.confidence,
    repro: buildReproArtifact(input),
  };
}

export function buildAgentFindingMeta(
  input: ReproInput & { confidence?: FindingConfidence }
): FindingMeta {
  return buildFindingMeta({
    ...input,
    source: "agent",
    confidence: input.confidence ?? "medium",
  });
}

export function buildAutoCaptureFindingMeta(
  input: ReproInput & { confidence?: FindingConfidence }
): FindingMeta {
  return buildFindingMeta({
    ...input,
    source: "auto-capture",
    confidence: input.confidence ?? "medium",
  });
}

export function buildConfirmedFindingMeta(
  input: ReproInput & { confidence?: FindingConfidence }
): FindingMeta {
  return buildFindingMeta({
    ...input,
    source: "confirmed",
    confidence: input.confidence ?? "high",
  });
}
