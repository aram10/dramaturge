import type { RunResult } from "../types.js";
import { collectFindings } from "./collector.js";

export function renderJson(result: RunResult): string {
  const findings = collectFindings(result.areaResults);
  const duration = result.endTime.getTime() - result.startTime.getTime();

  const report = {
    meta: {
      targetUrl: result.targetUrl,
      startTime: result.startTime.toISOString(),
      endTime: result.endTime.toISOString(),
      durationMs: duration,
      partial: result.partial,
    },
    summary: {
      areasExplored: result.areaResults.filter((a) => a.status === "explored")
        .length,
      totalSteps: result.areaResults.reduce((sum, a) => sum + a.steps, 0),
      totalFindings: findings.length,
      byCategory: Object.fromEntries(
        (
          [
            "Bug",
            "UX Concern",
            "Accessibility Issue",
            "Performance Issue",
            "Visual Glitch",
          ] as const
        ).map((cat) => [cat, findings.filter((f) => f.category === cat).length])
      ),
      bySeverity: Object.fromEntries(
        (["Critical", "Major", "Minor", "Trivial"] as const).map((sev) => [
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
    })),
    coverage: result.areaResults.map((a) => ({
      name: a.name,
      url: a.url ?? null,
      steps: a.steps,
      findings: a.findings.length,
      status: a.status,
      failureReason: a.failureReason ?? null,
    })),
    unexploredAreas: result.unexploredAreas,
  };

  return JSON.stringify(report, null, 2);
}
