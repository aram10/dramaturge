// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { CrossRunClassification, Finding, RunResult } from '../types.js';
import { collectFindings } from './collector.js';

function renderFindingTrace(
  finding: Finding
): { actionIds: string[]; evidenceIds: string[] } | null {
  const hasTrace =
    (finding.meta?.repro?.actionIds?.length ?? 0) > 0 ||
    (finding.meta?.repro?.evidenceIds?.length ?? 0) > 0;
  if (!hasTrace) {
    return null;
  }
  return {
    actionIds: finding.meta?.repro?.actionIds ?? [],
    evidenceIds: finding.meta?.repro?.evidenceIds ?? [],
  };
}

function renderCrossRunStatus(
  finding: Finding,
  classification: CrossRunClassification | undefined
): Omit<NonNullable<CrossRunClassification['byFindingId'][string]>, 'signature'> | null {
  const status = classification?.byFindingId[finding.id];
  if (!status) {
    return null;
  }
  const { signature: _signature, ...sanitizedStatus } = status;
  return sanitizedStatus;
}

function renderFinding(
  finding: Finding,
  classification: CrossRunClassification | undefined
): Record<string, unknown> {
  return {
    id: finding.id,
    category: finding.category,
    severity: finding.severity,
    area: finding.area,
    title: finding.title,
    stepsToReproduce: finding.stepsToReproduce,
    expected: finding.expected,
    actual: finding.actual,
    screenshot: finding.screenshot ?? null,
    evidenceIds: finding.evidenceIds ?? [],
    verdict: finding.verdict ?? null,
    trace: renderFindingTrace(finding),
    occurrenceCount: finding.occurrenceCount,
    impactedAreas: finding.impactedAreas,
    occurrences: finding.occurrences,
    meta: finding.meta ?? null,
    crossRunStatus: renderCrossRunStatus(finding, classification),
  };
}

export function renderJson(result: RunResult): string {
  const findings = collectFindings(result.areaResults);
  const duration = result.endTime.getTime() - result.startTime.getTime();
  const findingIdByRef = new Map<string, string>();

  for (const finding of findings) {
    for (const occurrence of finding.occurrences) {
      findingIdByRef.set(occurrence.ref, finding.id);
    }
  }

  const report = {
    meta: {
      targetUrl: result.targetUrl,
      startTime: result.startTime.toISOString(),
      endTime: result.endTime.toISOString(),
      durationMs: duration,
      partial: result.partial,
      partialReason: result.partialReason ?? null,
    },
    summary: {
      areasExplored: result.areaResults.filter((a) => a.status === 'explored').length,
      totalSteps: result.areaResults.reduce((sum, a) => sum + a.steps, 0),
      totalFindings: findings.length,
      byCategory: Object.fromEntries(
        (
          [
            'Bug',
            'UX Concern',
            'Accessibility Issue',
            'Performance Issue',
            'Visual Glitch',
          ] as const
        ).map((cat) => [cat, findings.filter((f) => f.category === cat).length])
      ),
      bySeverity: Object.fromEntries(
        (['Critical', 'Major', 'Minor', 'Trivial'] as const).map((sev) => [
          sev,
          findings.filter((f) => f.severity === sev).length,
        ])
      ),
    },
    findings: findings.map((finding) => renderFinding(finding, result.crossRunClassification)),
    crossRunSummary: result.crossRunClassification
      ? {
          ...result.crossRunClassification.summary,
          resolvedFindings: result.crossRunClassification.resolved.map((resolvedFinding) => {
            const { signature: _signature, ...safeResolvedFinding } = resolvedFinding;
            return safeResolvedFinding;
          }),
        }
      : null,
    coverage: result.areaResults.map((a) => ({
      name: a.name,
      url: a.url ?? null,
      pageType: a.pageType,
      steps: a.steps,
      findings: a.findings.length,
      controls: {
        discovered: a.coverage.controlsDiscovered,
        exercised: a.coverage.controlsExercised,
      },
      status: a.status,
      failureReason: a.failureReason ?? null,
      fingerprint: a.fingerprint?.hash ?? null,
    })),
    actions: result.areaResults.flatMap((a) =>
      (a.replayableActions ?? []).map((action) => ({
        ...action,
        areaName: a.name,
        route: a.url ?? null,
      }))
    ),
    evidence: result.areaResults.flatMap((a) =>
      a.evidence.map((ev) => ({
        id: ev.id,
        type: ev.type,
        summary: ev.summary,
        path: ev.path ?? null,
        areaName: ev.areaName ?? null,
        relatedFindingIds: Array.from(
          new Set(ev.relatedFindingIds.map((ref) => findingIdByRef.get(ref) ?? ref))
        ),
        timestamp: ev.timestamp,
      }))
    ),
    unexploredAreas: result.unexploredAreas,
    blindSpots: result.blindSpots.map((s) => ({
      nodeId: s.nodeId ?? null,
      summary: s.summary,
      reason: s.reason,
      severity: s.severity,
    })),
    stateGraph: result.stateGraphMermaid ?? null,
    runConfig: result.runConfig ?? null,
    runMemory: result.runMemory ?? null,
    safetyAudit: result.safetyAudit ?? null,
    costSummary: result.costSummary ?? null,
    explorationLedger: result.explorationLedger
      ? {
          version: result.explorationLedger.version,
          events: result.explorationLedger.events,
        }
      : null,
    workflowAutomaton: result.workflowAutomaton ?? null,
    workflowComparison: result.workflowComparison ?? null,
  };

  return JSON.stringify(report, null, 2);
}
