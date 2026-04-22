// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { RunResult } from '../types.js';
import { collectFindings } from './collector.js';

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
    findings: findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      area: f.area,
      title: f.title,
      stepsToReproduce: f.stepsToReproduce,
      expected: f.expected,
      actual: f.actual,
      screenshot: f.screenshot ?? null,
      evidenceIds: f.evidenceIds ?? [],
      verdict: f.verdict ?? null,
      trace:
        (f.meta?.repro?.actionIds?.length ?? 0) > 0 || (f.meta?.repro?.evidenceIds?.length ?? 0) > 0
          ? {
              actionIds: f.meta?.repro?.actionIds ?? [],
              evidenceIds: f.meta?.repro?.evidenceIds ?? [],
            }
          : null,
      occurrenceCount: f.occurrenceCount,
      impactedAreas: f.impactedAreas,
      occurrences: f.occurrences,
      meta: f.meta ?? null,
      crossRunStatus: result.crossRunClassification?.byFindingId[f.id] ?? null,
    })),
    crossRunSummary: result.crossRunClassification
      ? {
          ...result.crossRunClassification.summary,
          resolvedFindings: result.crossRunClassification.resolved,
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
  };

  return JSON.stringify(report, null, 2);
}
