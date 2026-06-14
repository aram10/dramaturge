// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type {
  ConfirmationResult,
  ConfirmationVerdict,
  Finding,
  FindingSeverity,
  ReplayValidation,
  ReplayValidationStatus,
  RunResult,
} from '../types.js';
import { collectFindings } from '../report/collector.js';
import { buildFindingReplayManifest } from './manifest.js';
import { confirmManifest, type ReplayAdapter } from './replayer.js';

/** Severities considered high-impact and validated by default (#137). */
export const DEFAULT_AUTO_VALIDATE_SEVERITIES: FindingSeverity[] = ['Critical', 'Major'];

/** Default cap on the number of findings validated per run to bound cost. */
export const DEFAULT_AUTO_VALIDATE_MAX_FINDINGS = 10;

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  Critical: 0,
  Major: 1,
  Minor: 2,
  Trivial: 3,
};

export interface AutoValidateOptions {
  /** Adapter that performs the live replay. When omitted, validation is unavailable. */
  adapter?: ReplayAdapter;
  /** Severities to validate (defaults to Critical + Major). */
  severities?: FindingSeverity[];
  /** Maximum number of findings to validate (defaults to 10). */
  maxFindings?: number;
  /** Auth profile carried into the replay manifest origin. */
  authProfile?: string;
}

export interface AutoValidateSummary {
  validated: number;
  confirmed: number;
  unconfirmed: number;
  flaky: number;
  unavailable: number;
}

function verdictToStatus(verdict: ConfirmationVerdict): ReplayValidationStatus {
  switch (verdict) {
    case 'still_reproducible':
      return 'confirmed';
    case 'fixed':
      return 'unconfirmed';
    case 'cannot_confirm':
      return 'unavailable';
    case 'changed_surface':
    case 'new_related_issue':
      return 'flaky';
  }
}

function toValidation(result: ConfirmationResult): ReplayValidation {
  return {
    status: verdictToStatus(result.verdict),
    verdict: result.verdict,
    confidence: result.confidence,
    actionsCompleted: result.replay.actionsCompleted,
    actionsRequested: result.replay.actionsRequested,
    durationMs: result.durationMs,
    ...(result.replay.stoppedReason ? { detail: result.replay.stoppedReason } : {}),
  };
}

function unavailableValidation(detail: string): ReplayValidation {
  return {
    status: 'unavailable',
    verdict: 'cannot_confirm',
    confidence: 'low',
    actionsCompleted: 0,
    actionsRequested: 0,
    durationMs: 0,
    detail,
  };
}

function selectHighImpactFindings(
  findings: Finding[],
  severities: Set<FindingSeverity>,
  maxFindings: number
): Finding[] {
  return findings
    .filter((finding) => severities.has(finding.severity))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, Math.max(0, maxFindings));
}

function emptySummary(): AutoValidateSummary {
  return { validated: 0, confirmed: 0, unconfirmed: 0, flaky: 0, unavailable: 0 };
}

function tallyStatus(summary: AutoValidateSummary, status: ReplayValidationStatus): void {
  summary.validated += 1;
  summary[status] += 1;
}

/**
 * Auto-validate high-impact (Critical/Major) findings by replaying each
 * finding's minimal action trace in a fresh context and recording a replay
 * validation status on the run result (#137).
 *
 * Findings are never dropped: when a replay cannot be constructed (no trace)
 * or the adapter fails, the finding is labeled `unavailable` rather than being
 * removed. Results are attached to `result.replayValidations`, keyed by the
 * finding signature so renderers can surface them.
 */
export async function validateHighImpactFindings(
  result: RunResult,
  options: AutoValidateOptions = {}
): Promise<AutoValidateSummary> {
  const severities = new Set(options.severities ?? DEFAULT_AUTO_VALIDATE_SEVERITIES);
  const maxFindings = options.maxFindings ?? DEFAULT_AUTO_VALIDATE_MAX_FINDINGS;
  const summary = emptySummary();

  const findings = collectFindings(result.areaResults);
  const targets = selectHighImpactFindings(findings, severities, maxFindings);
  if (targets.length === 0) {
    return summary;
  }

  const validations: Record<string, ReplayValidation> = { ...(result.replayValidations ?? {}) };

  for (const finding of targets) {
    const manifest = buildFindingReplayManifest(result, finding, {
      ...(options.authProfile ? { authProfile: options.authProfile } : {}),
    });

    let validation: ReplayValidation;
    if (manifest.replay.actions.length === 0) {
      validation = unavailableValidation(
        'No replayable action trace was recorded for this finding.'
      );
    } else {
      try {
        validation = toValidation(await confirmManifest(manifest, options.adapter));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        validation = unavailableValidation(`Replay failed: ${reason}`);
      }
    }

    validations[manifest.finding.signature] = validation;
    tallyStatus(summary, validation.status);
  }

  result.replayValidations = validations;
  return summary;
}
