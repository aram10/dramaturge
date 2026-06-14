// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Evidence } from '../types.js';
import type { Observation } from './types.js';

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
  confidence: 'low' | 'medium' | 'high';
  /**
   * Whether this grader actually applied to the observation. Non-applicable
   * graders (e.g. a network grader on a finding with no status codes) are
   * excluded from the combined-confidence floor so they no longer cap an
   * otherwise high-confidence finding at medium (#250).
   */
  applicable: boolean;
  /** Human-readable explanation. */
  reason: string;
  /** Source grader that produced this result. */
  grader: string;
  /**
   * True when the grader found a direct contradiction between the finding's
   * claim and the captured evidence (e.g. it claims a console error but none
   * was recorded). Contradictions are rejection signals (#206); a merely
   * evidence-light finding is low-confidence but not a contradiction.
   */
  contradiction?: boolean;
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
  const linkedEvidence = evidence.filter((ev) => observation.evidenceIds.includes(ev.id));
  const consoleErrors = linkedEvidence.filter((ev) => ev.type === 'console-error');

  const mentionsConsoleError =
    observation.actual.toLowerCase().includes('console error') ||
    observation.actual.toLowerCase().includes('error in console') ||
    observation.title.toLowerCase().includes('console error');

  if (mentionsConsoleError && consoleErrors.length === 0) {
    return {
      confirmed: false,
      confidence: 'low',
      applicable: true,
      contradiction: true,
      reason: 'Finding mentions console errors but no console-error evidence is linked.',
      grader: 'console-error',
    };
  }

  if (consoleErrors.length > 0) {
    return {
      confirmed: true,
      confidence: 'high',
      applicable: true,
      reason: `${consoleErrors.length} console error(s) captured as evidence.`,
      grader: 'console-error',
    };
  }

  return {
    confirmed: true,
    confidence: 'medium',
    applicable: false,
    reason: 'No console error evidence applicable — pass-through.',
    grader: 'console-error',
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
  const linkedEvidence = evidence.filter((ev) => observation.evidenceIds.includes(ev.id));
  const networkErrors = linkedEvidence.filter((ev) => ev.type === 'network-error');

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
      confidence: 'low',
      applicable: true,
      contradiction: true,
      reason: `Finding mentions HTTP status ${[...mentionedStatuses].join(', ')} but no network-error evidence is linked.`,
      grader: 'network-error',
    };
  }

  if (networkErrors.length > 0) {
    return {
      confirmed: true,
      confidence: 'high',
      applicable: true,
      reason: `${networkErrors.length} network error(s) captured as evidence.`,
      grader: 'network-error',
    };
  }

  return {
    confirmed: true,
    confidence: 'medium',
    applicable: false,
    reason: 'No network error evidence applicable — pass-through.',
    grader: 'network-error',
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
  const linkedEvidence = evidence.filter((ev) => observation.evidenceIds.includes(ev.id));

  if (linkedEvidence.length === 0) {
    return {
      confirmed: false,
      confidence: 'low',
      applicable: true,
      reason: 'Finding has no linked evidence.',
      grader: 'evidence-completeness',
    };
  }

  const types = new Set(linkedEvidence.map((ev) => ev.type));

  if (types.size >= 2) {
    return {
      confirmed: true,
      confidence: 'high',
      applicable: true,
      reason: `Finding supported by ${types.size} evidence types: ${[...types].join(', ')}.`,
      grader: 'evidence-completeness',
    };
  }

  return {
    confirmed: true,
    confidence: 'medium',
    applicable: true,
    reason: `Finding supported by ${linkedEvidence.length} evidence item(s) of type: ${[...types].join(', ')}.`,
    grader: 'evidence-completeness',
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
  combinedConfidence: 'low' | 'medium' | 'high';
  allConfirmed: boolean;
  anyRejected: boolean;
} {
  const results = [
    gradeByConsoleErrors(observation, evidence),
    gradeByNetworkErrors(observation, evidence),
    gradeByEvidenceCompleteness(observation, evidence),
  ];

  const allConfirmed = results.every((r) => r.confirmed);
  // A direct claim/evidence contradiction is an explicit rejection signal.
  const anyRejected = results.some((r) => r.contradiction === true);

  const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const;
  // Only applicable graders contribute to the floor so a non-applicable
  // pass-through no longer caps an otherwise high-confidence finding (#250).
  const applicable = results.filter((r) => r.applicable);
  const lowestConfidence = applicable.reduce<'low' | 'medium' | 'high'>(
    (min, r) => (CONFIDENCE_ORDER[r.confidence] < CONFIDENCE_ORDER[min] ? r.confidence : min),
    'high'
  );

  return {
    results,
    // With no applicable grader we have no deterministic signal — stay neutral.
    combinedConfidence: applicable.length > 0 ? lowestConfidence : 'medium',
    allConfirmed,
    anyRejected,
  };
}
