// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type {
  ConfirmationResult,
  ConfirmationVerdict,
  FindingConfidence,
  ReplayableAction,
} from '../types.js';
import type { FindingReplayManifest } from './manifest.js';
import { compareReplayOracles } from './oracles.js';

export type ReplayStepStatus = 'worked' | 'blocked' | 'error' | 'unclear';

export interface ReplayStepOutcome {
  actionId: string;
  status: ReplayStepStatus;
  summary: string;
}

export interface CurrentOracleObservation {
  consoleErrors: string[];
  networkFailures: Array<{ url: string; status: number }>;
  a11yRuleIds: string[];
  visualDiffRatio?: number;
}

export interface ManifestReplayResult {
  stepOutcomes: ReplayStepOutcome[];
  observed: CurrentOracleObservation;
  observedNow?: { expected?: string; actual?: string };
  evidence?: { screenshotRef?: string; consoleErrors?: string[] };
  durationMs: number;
  stoppedReason?: string;
}

export interface ReplayAdapter {
  replay(manifest: FindingReplayManifest): Promise<ManifestReplayResult>;
}

function actionOutcome(action: ReplayableAction): ReplayStepStatus {
  switch (action.status) {
    case 'worked':
    case 'recorded':
      return 'worked';
    case 'blocked':
      return 'blocked';
    case 'error':
      return 'error';
    case 'unclear':
      return 'unclear';
  }
}

function countOriginalConsoleErrors(manifest: FindingReplayManifest): number {
  return manifest.oracles.consoleErrorFragments?.length ?? 0;
}

function countOriginalNetworkFailures(manifest: FindingReplayManifest): number {
  return manifest.oracles.networkFailures?.length ?? 0;
}

function countOriginalA11yViolations(manifest: FindingReplayManifest): number {
  return manifest.oracles.a11yRuleIds?.length ?? 0;
}

function deriveConfidence(options: {
  verdict: ConfirmationVerdict;
  actionsRequested: number;
  actionsCompleted: number;
  oracleMatchRatio: number;
}): FindingConfidence {
  if (options.verdict === 'cannot_confirm') return 'low';
  if (options.actionsRequested === 0) return 'low';
  if (options.actionsCompleted < options.actionsRequested) return 'low';
  if (options.verdict === 'new_related_issue' || options.verdict === 'changed_surface') {
    return options.oracleMatchRatio > 0 ? 'medium' : 'low';
  }
  return options.oracleMatchRatio >= 1 ? 'high' : 'medium';
}

function deriveVerdict(options: {
  blockingStep?: ReplayStepOutcome;
  oracleSummary: ReturnType<typeof compareReplayOracles>;
  visualDiffRatio?: number;
  observedNow?: { expected?: string; actual?: string };
}): ConfirmationVerdict {
  if (options.blockingStep) return 'cannot_confirm';
  if (options.visualDiffRatio !== undefined && options.visualDiffRatio > 0.05) {
    return 'changed_surface';
  }
  if (options.oracleSummary.allOriginalMatched) return 'still_reproducible';
  if (options.oracleSummary.hasCurrentFailures) return 'new_related_issue';
  if (
    options.observedNow?.actual &&
    options.observedNow.expected &&
    options.observedNow.actual !== options.observedNow.expected
  ) {
    return 'new_related_issue';
  }
  return 'fixed';
}

export function evaluateReplayConfirmation(
  manifest: FindingReplayManifest,
  replayResult: ManifestReplayResult
): ConfirmationResult {
  const blockingStep = replayResult.stepOutcomes.find(
    (step) => step.status === 'blocked' || step.status === 'error'
  );
  const actionsRequested = manifest.replay.actions.length;
  const actionsCompleted = replayResult.stepOutcomes.filter(
    (step) => step.status === 'worked'
  ).length;
  const oracleSummary = compareReplayOracles(manifest, replayResult.observed);
  const verdict = deriveVerdict({
    blockingStep,
    oracleSummary,
    visualDiffRatio: replayResult.observed.visualDiffRatio,
    observedNow: replayResult.observedNow,
  });

  return {
    findingId: manifest.finding.id,
    signature: manifest.finding.signature,
    verdict,
    confidence: deriveConfidence({
      verdict,
      actionsRequested,
      actionsCompleted,
      oracleMatchRatio: oracleSummary.matchRatio,
    }),
    origin: {
      runStartedAt: manifest.origin.runStartedAt,
      targetUrl: manifest.origin.targetUrl,
    },
    replay: {
      actionsRequested,
      actionsCompleted,
      ...(blockingStep || replayResult.stoppedReason
        ? { stoppedReason: blockingStep?.summary ?? replayResult.stoppedReason }
        : {}),
    },
    oracleComparison: {
      consoleErrorsOriginal: countOriginalConsoleErrors(manifest),
      consoleErrorsCurrent: replayResult.observed.consoleErrors.length,
      networkFailuresOriginal: countOriginalNetworkFailures(manifest),
      networkFailuresCurrent: replayResult.observed.networkFailures.length,
      a11yViolationsOriginal: countOriginalA11yViolations(manifest),
      a11yViolationsCurrent: replayResult.observed.a11yRuleIds.length,
      ...(replayResult.observed.visualDiffRatio !== undefined
        ? { visualDiffRatio: replayResult.observed.visualDiffRatio }
        : {}),
    },
    observedNow: replayResult.observedNow ?? {},
    evidence: {
      ...(replayResult.evidence?.screenshotRef
        ? { screenshotRef: replayResult.evidence.screenshotRef }
        : {}),
      consoleErrors: replayResult.evidence?.consoleErrors ?? replayResult.observed.consoleErrors,
    },
    durationMs: replayResult.durationMs,
  };
}

export function buildStaticReplayResult(
  manifest: FindingReplayManifest,
  observed: CurrentOracleObservation
): ManifestReplayResult {
  return {
    stepOutcomes: manifest.replay.actions.map((action) => ({
      actionId: action.id,
      status: actionOutcome(action),
      summary: action.summary,
    })),
    observed,
    durationMs: 0,
  };
}

function cannotConfirmResult(manifest: FindingReplayManifest, reason: string): ConfirmationResult {
  return evaluateReplayConfirmation(manifest, {
    stepOutcomes: [
      {
        actionId: manifest.replay.actions[0]?.id ?? 'replay-adapter',
        status: 'blocked',
        summary: reason,
      },
    ],
    observed: { consoleErrors: [], networkFailures: [], a11yRuleIds: [] },
    durationMs: 0,
    stoppedReason: reason,
  });
}

export async function confirmManifest(
  manifest: FindingReplayManifest,
  adapter?: ReplayAdapter
): Promise<ConfirmationResult> {
  if (!adapter) {
    return cannotConfirmResult(
      manifest,
      'Live replay adapter is not configured in this first slice.'
    );
  }
  return evaluateReplayConfirmation(manifest, await adapter.replay(manifest));
}
