import type { AreaResult, BlindSpot, Finding, FindingSeverity, RunResult, RunConfigMeta } from "../types.js";
import { CATEGORY_PREFIX } from "../types.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  Critical: 0,
  Major: 1,
  Minor: 2,
  Trivial: 3,
};

export function collectFindings(areaResults: AreaResult[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let counter = 1;

  for (const area of areaResults) {
    for (const raw of area.findings) {
      // Deduplicate by title+severity (same issue found on different nodes)
      const dedupeKey = `${raw.severity}:${raw.title}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const prefix = CATEGORY_PREFIX[raw.category];
      const id = `${prefix}-${String(counter).padStart(3, "0")}`;
      counter++;

      const finding: Finding = {
        ...raw,
        id,
        area: area.name,
        screenshot: raw.screenshotRef
          ? `screenshots/${raw.screenshotRef}.png`
          : undefined,
      };
      findings.push(finding);
    }
  }

  // Sort by severity (Critical first), then by category
  findings.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.category.localeCompare(b.category);
  });

  // Re-number IDs after sorting
  for (let i = 0; i < findings.length; i++) {
    const prefix = CATEGORY_PREFIX[findings[i].category];
    findings[i].id = `${prefix}-${String(i + 1).padStart(3, "0")}`;
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
  runConfig?: RunConfigMeta
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
  };
}
