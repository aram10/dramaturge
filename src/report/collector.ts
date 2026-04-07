import type {
  AreaResult,
  BlindSpot,
  DiffSummary,
  Finding,
  FindingSeverity,
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

export function collectFindings(areaResults: AreaResult[]): Finding[] {
  const grouped = new Map<string, Finding>();
  let missingRefCounter = 1;

  for (const area of areaResults) {
    for (const raw of area.findings) {
      const findingRef = raw.ref ?? `fid-legacy-${missingRefCounter++}`;
      const groupKey = buildFindingGroupKey(raw);
      const occurrence = {
        area: area.name,
        route: raw.meta?.repro?.route,
        evidenceIds: raw.evidenceIds ?? [],
        ref: findingRef,
      };

      const existing = grouped.get(groupKey);
      if (existing) {
        existing.occurrences.push(occurrence);
        existing.impactedAreas = Array.from(new Set([...existing.impactedAreas, area.name]));
        existing.occurrenceCount = existing.occurrences.length;
        existing.evidenceIds = Array.from(
          new Set([...(existing.evidenceIds ?? []), ...(raw.evidenceIds ?? [])])
        );
        if (existing.meta?.repro || raw.meta?.repro) {
          existing.meta = existing.meta ?? raw.meta;
          if (existing.meta) {
            existing.meta = {
              ...existing.meta,
              repro: {
                ...(existing.meta.repro ?? raw.meta?.repro),
                objective:
                  existing.meta.repro?.objective ??
                  raw.meta?.repro?.objective ??
                  'Investigate observed issue',
                actionIds: Array.from(
                  new Set([
                    ...(existing.meta.repro?.actionIds ?? []),
                    ...(raw.meta?.repro?.actionIds ?? []),
                  ])
                ),
                evidenceIds: Array.from(
                  new Set([
                    ...(existing.meta.repro?.evidenceIds ?? []),
                    ...(raw.meta?.repro?.evidenceIds ?? []),
                  ])
                ),
                breadcrumbs: Array.from(
                  new Set([
                    ...(existing.meta.repro?.breadcrumbs ?? []),
                    ...(raw.meta?.repro?.breadcrumbs ?? []),
                  ])
                ),
              },
            };
          }
        }
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
  partial: boolean,
  blindSpots: BlindSpot[] = [],
  stateGraphMermaid?: string,
  runConfig?: RunConfigMeta,
  runMemory?: RunMemoryMeta,
  diffSummary?: DiffSummary
): RunResult {
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
  };
}
