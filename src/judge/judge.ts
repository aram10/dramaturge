import { shortId } from "../constants.js";
import { buildAgentFindingMeta } from "../repro/repro.js";
import type { RawFinding } from "../types.js";
import { buildTraceBundle } from "./bundle.js";
import { buildJudgePrompt } from "./prompt.js";
import type {
  JudgeDecision,
  JudgeWorkerObservationsInput,
  Observation,
} from "./types.js";

function ensureShouldHypothesis(text: string): string {
  const trimmed = text.trim();
  if (/\bshould\b/i.test(trimmed)) {
    return trimmed;
  }

  return `The expected behavior should be: ${trimmed.replace(/\.*$/, "")}.`;
}

function buildDeterministicDecision(observation: Observation): JudgeDecision {
  return {
    hypothesis: ensureShouldHypothesis(
      observation.verdictHint?.hypothesis ?? observation.expected
    ),
    observation: observation.verdictHint?.observation ?? observation.actual,
    alternativesConsidered:
      observation.verdictHint?.alternativesConsidered ?? [],
    suggestedVerification:
      observation.verdictHint?.suggestedVerification ?? [
        `Repeat the flow for "${observation.title}" on a fresh page load.`,
      ],
    confidence: "medium",
  };
}

function materializeFinding(
  observation: Observation,
  decision: JudgeDecision,
  traceBundle: ReturnType<typeof buildTraceBundle>
): RawFinding {
  const findingRef = `fid-${shortId()}`;

  return {
    ref: findingRef,
    category: observation.category,
    severity: observation.severity,
    title: observation.title,
    stepsToReproduce: observation.stepsToReproduce,
    expected: observation.expected,
    actual: observation.actual,
    evidenceIds: observation.evidenceIds,
    verdict: {
      hypothesis: ensureShouldHypothesis(decision.hypothesis),
      observation: decision.observation,
      evidenceChain: [...new Set([...observation.evidenceIds, ...traceBundle.actionIds])],
      alternativesConsidered: decision.alternativesConsidered,
      suggestedVerification: decision.suggestedVerification,
    },
    meta: buildAgentFindingMeta({
      route: observation.route,
      objective: observation.objective,
      breadcrumbs: observation.breadcrumbs,
      actionIds: traceBundle.actionIds,
      evidenceIds: traceBundle.evidenceIds,
      confidence: decision.confidence ?? "medium",
    }),
  };
}

export async function judgeWorkerObservations(
  input: JudgeWorkerObservationsInput
): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  for (const observation of input.observations) {
    const traceBundle = buildTraceBundle(observation, input.evidence, input.actions);
    let decision = buildDeterministicDecision(observation);

    if (input.config?.enabled !== false && input.judgeText) {
      try {
        decision = await input.judgeText(
          buildJudgePrompt(observation, traceBundle),
          input.config?.requestTimeoutMs ?? 15_000
        );
      } catch {
        decision = {
          ...decision,
          alternativesConsidered: [
            ...decision.alternativesConsidered,
            "Judge fallback used because the preferred judgment path failed.",
          ],
        };
      }
    }

    const finding = materializeFinding(observation, decision, traceBundle);
    findings.push(finding);

    for (const item of input.evidence) {
      item.relatedFindingIds = item.relatedFindingIds.map((relatedId) =>
        relatedId === observation.id ? finding.ref ?? relatedId : relatedId
      );
    }
  }

  return findings;
}
