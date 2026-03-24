import type { RunResult } from "../types.js";
import { collectFindings } from "./collector.js";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function renderMarkdown(result: RunResult): string {
  const findings = collectFindings(result.areaResults);
  const duration = result.endTime.getTime() - result.startTime.getTime();
  const exploredAreas = result.areaResults.filter(
    (a) => a.status === "explored"
  );
  const totalSteps = result.areaResults.reduce((sum, a) => sum + a.steps, 0);

  const bugs = findings.filter((f) => f.category === "Bug");
  const ux = findings.filter((f) => f.category === "UX Concern");
  const a11y = findings.filter((f) => f.category === "Accessibility Issue");
  const perf = findings.filter((f) => f.category === "Performance Issue");
  const visual = findings.filter((f) => f.category === "Visual Glitch");

  const lines: string[] = [];

  // Header
  const timestamp = result.startTime
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  lines.push(`# WebProbe Report — ${timestamp}`);
  if (result.partial) {
    lines.push(
      "> **Warning:** This run was incomplete. Some areas may not have been explored."
    );
    lines.push("");
  }
  lines.push(`**Target:** ${result.targetUrl}`);
  lines.push(
    `**Duration:** ${formatDuration(duration)} | **Areas explored:** ${exploredAreas.length} | **Total steps:** ${totalSteps}`
  );
  lines.push("");

  // Summary
  lines.push("## Summary");
  if (findings.length === 0) {
    lines.push("- No issues found");
  } else {
    if (bugs.length > 0) {
      const severities = bugs.map((b) => b.severity.toLowerCase());
      const breakdown = [...new Set(severities)]
        .map((s) => `${severities.filter((x) => x === s).length} ${s}`)
        .join(", ");
      lines.push(`- ${bugs.length} bug(s) found (${breakdown})`);
    }
    if (ux.length > 0) lines.push(`- ${ux.length} UX concern(s)`);
    if (a11y.length > 0) lines.push(`- ${a11y.length} accessibility issue(s)`);
    if (perf.length > 0) lines.push(`- ${perf.length} performance issue(s)`);
    if (visual.length > 0) lines.push(`- ${visual.length} visual glitch(es)`);
  }
  lines.push("");

  // Findings
  if (findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of findings) {
      lines.push(`### [${f.id}] ${f.severity}: ${f.title}`);
      lines.push(`- **Area:** ${f.area}`);
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Severity:** ${f.severity}`);
      lines.push("- **Steps to reproduce:**");
      f.stepsToReproduce.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
      lines.push(`- **Expected:** ${f.expected}`);
      lines.push(`- **Actual:** ${f.actual}`);
      if (f.screenshot) {
        lines.push(`- **Screenshot:** ${f.screenshot}`);
      }
      lines.push("");
    }
  }

  // Coverage Map
  lines.push("## Coverage Map");
  lines.push("| Area | Steps | Findings | Status |");
  lines.push("|------|-------|----------|--------|");
  for (const area of result.areaResults) {
    lines.push(
      `| ${area.name} | ${area.steps} | ${area.findings.length} | ${area.status} |`
    );
  }
  lines.push("");

  // Unexplored Areas
  if (result.unexploredAreas.length > 0) {
    lines.push("## Areas Not Explored");
    for (const area of result.unexploredAreas) {
      lines.push(`- ${area.name} (${area.reason})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
