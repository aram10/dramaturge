// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { shortId } from '../constants.js';
import { buildAgentFindingMeta } from '../repro/repro.js';
import type { RawFinding } from '../types.js';
import { buildTraceBundle } from './bundle.js';
import { runDeterministicGraders } from './deterministic-graders.js';
import { buildJudgePrompt } from './prompt.js';
import type { JudgeDecision, JudgeWorkerObservationsInput, Observation } from './types.js';

function ensureShouldHypothesis(text: string): string {
  const trimmed = text.trim();
  if (/\bshould\b/i.test(trimmed)) {
    return trimmed;
  }

  return `The expected behavior should be: ${trimmed.replace(/\.*$/, '')}.`;
}

function buildDeterministicDecision(observation: Observation): JudgeDecision {
  return {
    hypothesis: ensureShouldHypothesis(observation.verdictHint?.hypothesis ?? observation.expected),
    observation: observation.verdictHint?.observation ?? observation.actual,
    alternativesConsidered: observation.verdictHint?.alternativesConsidered ?? [],
    suggestedVerification: observation.verdictHint?.suggestedVerification ?? [
      `Repeat the flow for "${observation.title}" on a fresh page load.`,
    ],
    confidence: 'medium',
  };
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const;

function meetsConfidenceThreshold(
  confidence: JudgeDecision['confidence'],
  minConfidence: 'low' | 'medium' | 'high'
): boolean {
  return CONFIDENCE_RANK[confidence ?? 'medium'] >= CONFIDENCE_RANK[minConfidence];
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
      evidenceChain: [...new Set([...observation.evidenceIds, ...traceBundle.evidenceIds])],
      alternativesConsidered: decision.alternativesConsidered,
      suggestedVerification: decision.suggestedVerification,
    },
    meta: buildAgentFindingMeta({
      route: observation.route,
      objective: observation.objective,
      breadcrumbs: observation.breadcrumbs,
      actionIds: traceBundle.actionIds,
      evidenceIds: traceBundle.evidenceIds,
      confidence: decision.confidence ?? 'medium',
    }),
  };
}

function deriveDisposition(
  decision: JudgeDecision,
  llmJudged: boolean,
  graderResult: ReturnType<typeof runDeterministicGraders>
): NonNullable<JudgeDecision['disposition']> {
  if (decision.disposition !== undefined) {
    return decision.disposition;
  }
  // The LLM judge is the higher authority: when it ran we honour its decision.
  // Only the deterministic fast path (no LLM judge available) quarantines an
  // explicitly disconfirmed, low-confidence observation (#206).
  return !llmJudged && graderResult.anyRejected && graderResult.combinedConfidence === 'low'
    ? 'rejected'
    : 'confirmed';
}

export async function judgeWorkerObservations(
  input: JudgeWorkerObservationsInput
): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  for (const observation of input.observations) {
    const traceBundle = buildTraceBundle(observation, input.evidence, input.actions);
    let decision = buildDeterministicDecision(observation);

    // Run deterministic graders before LLM judge
    const graderResult = runDeterministicGraders(observation, input.evidence);
    decision.confidence = graderResult.combinedConfidence;

    const graderNotes = graderResult.results
      .filter((r) => !r.confirmed)
      .map((r) => `Deterministic grader "${r.grader}": ${r.reason}`);

    const deterministicFullyConfident =
      graderResult.combinedConfidence === 'high' && graderResult.allConfirmed;

    let llmJudged = false;
    if (!deterministicFullyConfident && input.config?.enabled !== false && input.judgeText) {
      try {
        decision = await input.judgeText(
          buildJudgePrompt(observation, traceBundle),
          input.config?.requestTimeoutMs ?? 15_000
        );
        llmJudged = true;
      } catch {
        decision = {
          ...decision,
          alternativesConsidered: [
            ...decision.alternativesConsidered,
            'Judge fallback used because the preferred judgment path failed.',
          ],
        };
      }
    }

    // Append deterministic grader notes to final decision
    if (graderNotes.length > 0) {
      decision.alternativesConsidered = [...decision.alternativesConsidered, ...graderNotes];
    }

    // Derive a disposition (#206).
    decision.disposition = deriveDisposition(decision, llmJudged, graderResult);

    const dropRejected = input.config?.dropRejected !== false;
    if (decision.disposition === 'rejected' && dropRejected) {
      continue;
    }

    const minConfidence = input.config?.minConfidence ?? 'low';
    if (!meetsConfidenceThreshold(decision.confidence, minConfidence)) {
      continue;
    }

    const finding = materializeFinding(observation, decision, traceBundle);
    findings.push(finding);

    for (const item of input.evidence) {
      item.relatedFindingIds = item.relatedFindingIds.map((relatedId) =>
        relatedId === observation.id ? (finding.ref ?? relatedId) : relatedId
      );
    }
  }

  return findings;
}
