import type { AreaResult, Finding, RunResult } from "../types.js";
import { CATEGORY_PREFIX } from "../types.js";

export function collectFindings(areaResults: AreaResult[]): Finding[] {
  const findings: Finding[] = [];
  let counter = 1;

  for (const area of areaResults) {
    for (const raw of area.findings) {
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

  return findings;
}

export function buildRunResult(
  targetUrl: string,
  startTime: Date,
  areaResults: AreaResult[],
  unexploredAreas: Array<{ name: string; reason: string }>,
  partial: boolean
): RunResult {
  return {
    targetUrl,
    startTime,
    endTime: new Date(),
    areaResults,
    unexploredAreas,
    partial,
  };
}
