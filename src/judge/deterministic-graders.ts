import type { Evidence } from "../types.js";
import type { Observation, JudgeDecision } from "./types.js";

/**
 * Deterministic judge graders for finding validation.
 *
 * Inspired by ECC's AI regression testing and eval harness skills.
 * These complement the LLM-based judge by providing code-based validation
 * that doesn't share the LLM's blind spots.
 *
 * Three grader types:
 * 1. Console error grader — validate based on console error counts
 * 2. HTTP status grader — validate based on network error patterns
 * 3. Evidence completeness grader — validate that findings have supporting evidence
 */

export interface DeterministicGradeResult {
  /** Whether the deterministic grader confirmed the finding. */
  confirmed: boolean;
  /** Confidence from the deterministic check. */
  confidence: "low" | "medium" | "high";
  /** Human-readable explanation. */
  reason: string;
  /** Source grader that produced this result. */
  grader: string;
}

/**
 * Grade an observation based on whether it has console error evidence.
 *
 * If the finding claims a console error but no console-error evidence exists,
 * the grader downgrades confidence. If console errors are present and match
 * the finding, confidence is boosted.
 */
export function gradeByConsoleErrors(
  observation: Observation,
  evidence: Evidence[]
): DeterministicGradeResult {
  const linkedEvidence = evidence.filter((ev) =>
    observation.evidenceIds.includes(ev.id)
  );
  const consoleErrors = linkedEvidence.filter(
    (ev) => ev.type === "console-error"
  );

  const mentionsConsoleError =
    observation.actual.toLowerCase().includes("console error") ||
    observation.actual.toLowerCase().includes("error in console") ||
    observation.title.toLowerCase().includes("console error");

  if (mentionsConsoleError && consoleErrors.length === 0) {
    return {
      confirmed: false,
      confidence: "low",
      reason:
        "Finding mentions console errors but no console-error evidence is linked.",
      grader: "console-error",
    };
  }

  if (consoleErrors.length > 0) {
    return {
      confirmed: true,
      confidence: "high",
      reason: `${consoleErrors.length} console error(s) captured as evidence.`,
      grader: "console-error",
    };
  }

  return {
    confirmed: true,
    confidence: "medium",
    reason: "No console error evidence applicable — pass-through.",
    grader: "console-error",
  };
}

/**
 * Grade an observation based on network error evidence.
 *
 * Cross-validates findings that mention HTTP status codes against actual
 * network-error evidence.
 */
export function gradeByNetworkErrors(
  observation: Observation,
  evidence: Evidence[]
): DeterministicGradeResult {
  const linkedEvidence = evidence.filter((ev) =>
    observation.evidenceIds.includes(ev.id)
  );
  const networkErrors = linkedEvidence.filter(
    (ev) => ev.type === "network-error"
  );

  // Check if the finding text mentions specific HTTP status codes
  const statusPattern = /\b([45]\d{2})\b/g;
  const mentionedStatuses = new Set<string>();
  for (const match of observation.actual.matchAll(statusPattern)) {
    mentionedStatuses.add(match[1]);
  }
  for (const match of observation.title.matchAll(statusPattern)) {
    mentionedStatuses.add(match[1]);
  }

  if (mentionedStatuses.size > 0 && networkErrors.length === 0) {
    return {
      confirmed: false,
      confidence: "low",
      reason: `Finding mentions HTTP status ${[...mentionedStatuses].join(", ")} but no network-error evidence is linked.`,
      grader: "network-error",
    };
  }

  if (networkErrors.length > 0) {
    return {
      confirmed: true,
      confidence: "high",
      reason: `${networkErrors.length} network error(s) captured as evidence.`,
      grader: "network-error",
    };
  }

  return {
    confirmed: true,
    confidence: "medium",
    reason: "No network error evidence applicable — pass-through.",
    grader: "network-error",
  };
}

/**
 * Grade an observation based on evidence completeness.
 *
 * Findings with no evidence at all get low confidence.
 * Findings with screenshots get medium.
 * Findings with multiple evidence types get high.
 */
export function gradeByEvidenceCompleteness(
  observation: Observation,
  evidence: Evidence[]
): DeterministicGradeResult {
  const linkedEvidence = evidence.filter((ev) =>
    observation.evidenceIds.includes(ev.id)
  );

  if (linkedEvidence.length === 0) {
    return {
      confirmed: false,
      confidence: "low",
      reason: "Finding has no linked evidence.",
      grader: "evidence-completeness",
    };
  }

  const types = new Set(linkedEvidence.map((ev) => ev.type));

  if (types.size >= 2) {
    return {
      confirmed: true,
      confidence: "high",
      reason: `Finding supported by ${types.size} evidence types: ${[...types].join(", ")}.`,
      grader: "evidence-completeness",
    };
  }

  return {
    confirmed: true,
    confidence: "medium",
    reason: `Finding supported by ${linkedEvidence.length} evidence item(s) of type: ${[...types].join(", ")}.`,
    grader: "evidence-completeness",
  };
}

/**
 * Run all deterministic graders and return a combined confidence assessment.
 *
 * The lowest confidence from any grader becomes the combined confidence.
 * If any grader explicitly disconfirms, the combined result is not confirmed.
 */
export function runDeterministicGraders(
  observation: Observation,
  evidence: Evidence[]
): {
  results: DeterministicGradeResult[];
  combinedConfidence: "low" | "medium" | "high";
  allConfirmed: boolean;
} {
  const results = [
    gradeByConsoleErrors(observation, evidence),
    gradeByNetworkErrors(observation, evidence),
    gradeByEvidenceCompleteness(observation, evidence),
  ];

  const allConfirmed = results.every((r) => r.confirmed);

  const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
  const lowestConfidence = results.reduce(
    (min, r) =>
      CONFIDENCE_ORDER[r.confidence] < CONFIDENCE_ORDER[min]
        ? r.confidence
        : min,
    "high" as "low" | "medium" | "high"
  );

  return {
    results,
    combinedConfidence: lowestConfidence,
    allConfirmed,
  };
}
