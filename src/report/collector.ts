// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type {
  AreaResult,
  BlindSpot,
  CrossRunClassification,
  DiffSummary,
  Finding,
  FindingOccurrence,
  FindingSeverity,
  RawFinding,
  RunConfigMeta,
  RunMemoryMeta,
  RunResult,
} from '../types.js';
import { CATEGORY_PREFIX } from '../types.js';
import { FINDING_ID_PAD } from '../constants.js';

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  Critical: 0,
  Major: 1,
  Minor: 2,
  Trivial: 3,
};

export function buildFindingGroupKey(input: {
  category: string;
  severity: string;
  title: string;
  expected: string;
  actual: string;
}): string {
  return JSON.stringify([
    input.category,
    input.severity,
    input.title,
    input.expected,
    input.actual,
  ]);
}

function mergeUniqueStrings(...arrays: Array<string[] | undefined>): string[] {
  return Array.from(new Set(arrays.flatMap((a) => a ?? [])));
}

function mergeReproData(existing: Finding, raw: RawFinding): Finding['meta'] {
  const base = existing.meta ?? raw.meta;
  if (!base) return undefined;
  const er = existing.meta?.repro;
  const rr = raw.meta?.repro;
  return {
    ...base,
    repro: {
      ...(er ?? rr),
      objective: er?.objective ?? rr?.objective ?? 'Investigate observed issue',
      actionIds: mergeUniqueStrings(er?.actionIds, rr?.actionIds),
      evidenceIds: mergeUniqueStrings(er?.evidenceIds, rr?.evidenceIds),
      breadcrumbs: mergeUniqueStrings(er?.breadcrumbs, rr?.breadcrumbs),
    },
  };
}

function mergeExistingFinding(
  existing: Finding,
  raw: RawFinding,
  occurrence: FindingOccurrence
): void {
  existing.occurrences.push(occurrence);
  existing.impactedAreas = Array.from(new Set([...existing.impactedAreas, occurrence.area]));
  existing.occurrenceCount = existing.occurrences.length;
  existing.evidenceIds = Array.from(
    new Set([...(existing.evidenceIds ?? []), ...(raw.evidenceIds ?? [])])
  );
  if (existing.meta?.repro || raw.meta?.repro) {
    existing.meta = mergeReproData(existing, raw);
  }
}

export function collectFindings(areaResults: AreaResult[]): Finding[] {
  const grouped = new Map<string, Finding>();
  let missingRefCounter = 1;

  for (const area of areaResults) {
    for (const raw of area.findings) {
      const findingRef = raw.ref ?? `fid-legacy-${missingRefCounter++}`;
      const groupKey = buildFindingGroupKey(raw);
      const occurrence: FindingOccurrence = {
        area: area.name,
        route: raw.meta?.repro?.route,
        evidenceIds: raw.evidenceIds ?? [],
        ref: findingRef,
      };

      const existing = grouped.get(groupKey);
      if (existing) {
        mergeExistingFinding(existing, raw, occurrence);
        continue;
      }

      grouped.set(groupKey, {
        ...raw,
        ref: findingRef,
        id: '',
        area: area.name,
        screenshot: raw.screenshotRef ? `screenshots/${raw.screenshotRef}.png` : undefined,
        occurrenceCount: 1,
        impactedAreas: [area.name],
        occurrences: [occurrence],
        evidenceIds: raw.evidenceIds ?? [],
      });
    }
  }

  const findings = [...grouped.values()];

  // Sort by severity (Critical first), then by category
  findings.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const catDiff = a.category.localeCompare(b.category);
    if (catDiff !== 0) return catDiff;
    return a.title.localeCompare(b.title);
  });

  // Re-number IDs after sorting
  for (let i = 0; i < findings.length; i++) {
    const prefix = CATEGORY_PREFIX[findings[i].category];
    findings[i].id = `${prefix}-${String(i + 1).padStart(FINDING_ID_PAD, '0')}`;
  }

  return findings;
}

export function buildRunResult(
  targetUrl: string,
  startTime: Date,
  areaResults: AreaResult[],
  unexploredAreas: Array<{ name: string; reason: string }>,
  options: {
    partial: boolean;
    blindSpots?: BlindSpot[];
    stateGraphMermaid?: string;
    runConfig?: RunConfigMeta;
    runMemory?: RunMemoryMeta;
    diffSummary?: DiffSummary;
    crossRunClassification?: CrossRunClassification;
    safetyAudit?: RunResult['safetyAudit'];
    explorationLedger?: RunResult['explorationLedger'];
    workflowAutomaton?: RunResult['workflowAutomaton'];
    workflowComparison?: RunResult['workflowComparison'];
  }
): RunResult {
  const {
    partial,
    blindSpots = [],
    stateGraphMermaid,
    runConfig,
    runMemory,
    diffSummary,
    crossRunClassification,
    safetyAudit,
    explorationLedger,
    workflowAutomaton,
    workflowComparison,
  } = options;

  return {
    targetUrl,
    startTime,
    endTime: new Date(),
    areaResults,
    unexploredAreas,
    partial,
    blindSpots,
    stateGraphMermaid,
    runConfig,
    runMemory,
    diffSummary,
    crossRunClassification,
    safetyAudit,
    explorationLedger,
    workflowAutomaton,
    workflowComparison,
  };
}
