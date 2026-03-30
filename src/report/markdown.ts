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
  const findingIdByRef = new Map<string, string>();
  const exploredAreas = result.areaResults.filter(
    (a) => a.status === "explored"
  );
  const totalSteps = result.areaResults.reduce((sum, a) => sum + a.steps, 0);

  for (const finding of findings) {
    for (const occurrence of finding.occurrences) {
      findingIdByRef.set(occurrence.ref, finding.id);
    }
  }

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
  lines.push(`# Dramaturge Report — ${timestamp}`);
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
      const steps = f.stepsToReproduce.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
      lines.push(`### [${f.id}] ${f.severity}: ${f.title}`);
      lines.push(`- **Area:** ${f.area}`);
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **Severity:** ${f.severity}`);
      lines.push(`- **Steps to reproduce:**`);
      lines.push(steps);
      lines.push(`- **Expected:** ${f.expected}`);
      lines.push(`- **Actual:** ${f.actual}`);
      if (f.verdict) {
        lines.push(`- **Hypothesis:** ${f.verdict.hypothesis}`);
        lines.push(`- **Observation:** ${f.verdict.observation}`);
        if (f.verdict.evidenceChain.length > 0) {
          lines.push(`- **Evidence chain:** ${f.verdict.evidenceChain.join(" | ")}`);
        }
        if (f.verdict.alternativesConsidered.length > 0) {
          lines.push(
            `- **Alternative explanations:** ${f.verdict.alternativesConsidered.join(
              " | "
            )}`
          );
        }
        if (f.verdict.suggestedVerification.length > 0) {
          lines.push(
            `- **Suggested verification:** ${f.verdict.suggestedVerification.join(
              " | "
            )}`
          );
        }
      }
      if (f.occurrenceCount > 1) {
        lines.push(`- **Occurrences:** ${f.occurrenceCount}`);
        lines.push(`- **Impacted areas:** ${f.impactedAreas.join(", ")}`);
      }
      if (f.screenshot) {
        lines.push(`- **Screenshot:** ${f.screenshot}`);
      }
      if (f.meta) {
        lines.push(`- **Source:** ${f.meta.source}`);
        lines.push(`- **Confidence:** ${f.meta.confidence}`);
        if (f.meta.repro?.stateId) {
          lines.push(`- **Repro state:** ${f.meta.repro.stateId}`);
        }
        if (f.meta.repro?.route) {
          lines.push(`- **Repro route:** ${f.meta.repro.route}`);
        }
        if (f.meta.repro?.objective) {
          lines.push(`- **Repro objective:** ${f.meta.repro.objective}`);
        }
        if ((f.meta.repro?.breadcrumbs?.length ?? 0) > 0) {
          lines.push(`- **Repro breadcrumbs:** ${f.meta.repro?.breadcrumbs.join(" | ")}`);
        }
        if ((f.meta.repro?.actionIds?.length ?? 0) > 0) {
          lines.push(`- **Repro action ids:** ${f.meta.repro?.actionIds?.join(", ")}`);
        }
        if ((f.meta.repro?.evidenceIds?.length ?? 0) > 0) {
          lines.push(`- **Repro evidence:** ${f.meta.repro?.evidenceIds.join(", ")}`);
        }
        if (
          (f.meta.repro?.actionIds?.length ?? 0) > 0 ||
          (f.meta.repro?.evidenceIds?.length ?? 0) > 0
        ) {
          lines.push(
            `- **Trace bundle:** actions=${f.meta.repro?.actionIds?.join(", ") || "none"} | evidence=${f.meta.repro?.evidenceIds?.join(", ") || "none"}`
          );
        }
      }
      lines.push("");
    }
  }

  // Coverage Map
  lines.push("## Coverage Map");
  lines.push("| Area | Page Type | Steps | Findings | Controls (exercised/discovered) | Status |");
  lines.push("|------|-----------|-------|----------|-------------------------------|--------|");
  for (const area of result.areaResults) {
    const coverageStr = area.coverage.controlsDiscovered > 0
      ? `${area.coverage.controlsExercised}/${area.coverage.controlsDiscovered}`
      : "—";
    lines.push(
      `| ${area.name} | ${area.pageType} | ${area.steps} | ${area.findings.length} | ${coverageStr} | ${area.status} |`
    );
  }
  lines.push("");

  // Coverage Summary
  const totalControlsDiscovered = result.areaResults.reduce(
    (sum, a) => sum + a.coverage.controlsDiscovered, 0
  );
  const totalControlsExercised = result.areaResults.reduce(
    (sum, a) => sum + a.coverage.controlsExercised, 0
  );
  if (totalControlsDiscovered > 0) {
    const pct = Math.round((totalControlsExercised / totalControlsDiscovered) * 100);
    lines.push("## Coverage Summary");
    lines.push(`- **Controls discovered:** ${totalControlsDiscovered}`);
    lines.push(`- **Controls exercised:** ${totalControlsExercised} (${pct}%)`);
    lines.push("");
  }

  // Evidence Index
  const allEvidence = result.areaResults.flatMap((a) => a.evidence);
  if (allEvidence.length > 0) {
    lines.push("## Evidence Index");
    lines.push("| ID | Type | Area | Summary | Path | Related findings |");
    lines.push("|----|------|------|---------|------|------------------|");
    for (const ev of allEvidence) {
      const relatedFindings = Array.from(
        new Set(ev.relatedFindingIds.map((ref) => findingIdByRef.get(ref) ?? ref))
      );
      lines.push(
        `| ${ev.id} | ${ev.type} | ${ev.areaName ?? "—"} | ${ev.summary} | ${ev.path ?? "—"} | ${relatedFindings.join(", ") || "—"} |`
      );
    }
    lines.push("");
  }

  const allActions = result.areaResults.flatMap((area) =>
    (area.replayableActions ?? []).map((action) => ({
      areaName: area.name,
      ...action,
    }))
  );
  if (allActions.length > 0) {
    lines.push("## Action Trace");
    lines.push("| ID | Area | Kind | Source | Summary | Status |");
    lines.push("|----|------|------|--------|---------|--------|");
    for (const action of allActions) {
      lines.push(
        `| ${action.id} | ${action.areaName} | ${action.kind} | ${action.source} | ${action.summary} | ${action.status} |`
      );
    }
    lines.push("");
  }

  // Unexplored Areas
  if (result.unexploredAreas.length > 0) {
    lines.push("## Areas Not Explored");
    for (const area of result.unexploredAreas) {
      lines.push(`- ${area.name} (${area.reason})`);
    }
    lines.push("");
  }

  // Blind Spots
  if (result.blindSpots.length > 0) {
    lines.push("## Blind Spots");
    lines.push(
      "Areas where testing coverage may be incomplete:"
    );
    lines.push("");
    lines.push("| Severity | Reason | Summary |");
    lines.push("|----------|--------|---------|");
    for (const spot of result.blindSpots) {
      lines.push(`| ${spot.severity} | ${spot.reason} | ${spot.summary} |`);
    }
    lines.push("");
  }

  // State Graph
  if (result.stateGraphMermaid) {
    lines.push("## State Graph");
    lines.push("");
    lines.push("```mermaid");
    lines.push(result.stateGraphMermaid);
    lines.push("```");
    lines.push("");
  }

  // Run Configuration
  if (result.runMemory) {
    const rm = result.runMemory;
    lines.push(`## Run Memory
- **Enabled:** ${rm.enabled ? "yes" : "no"}
- **Warm start applied:** ${rm.warmStartApplied ? "yes" : "no"}
- **Restored states:** ${rm.restoredStateCount}
- **Known findings tracked:** ${rm.knownFindingCount}
- **Suppressed findings:** ${rm.suppressedFindingCount}
- **Flaky pages noted:** ${rm.flakyPageCount}
- **Visual baselines tracked:** ${rm.visualBaselineCount}`);
    lines.push("");
  }

  if (result.runConfig) {
    const rc = result.runConfig;
    const ckpt = rc.checkpointInterval === 0 ? "disabled" : `every ${rc.checkpointInterval} tasks`;
    lines.push(`## Run Configuration
- **App:** ${rc.appDescription}
- **Planner model:** ${rc.models.planner}
- **Worker model:** ${rc.models.worker}
- **Concurrency:** ${rc.concurrency} worker(s)
- **Budget:** ${rc.budget.timeLimitSeconds}s time limit, ${rc.budget.maxStepsPerTask} steps/task, ${rc.budget.maxStateNodes} max states
- **Checkpoint interval:** ${ckpt}
- **Auto-capture:** ${rc.autoCaptureEnabled ? "enabled" : "disabled"}
- **LLM planner:** ${rc.llmPlannerEnabled ? "enabled" : "disabled"}
- **Memory:** ${rc.memoryEnabled ? "enabled" : "disabled"}
- **Warm start:** ${rc.warmStartEnabled ? "enabled" : "disabled"}
- **Visual regression:** ${rc.visualRegressionEnabled ? "enabled" : "disabled"}`);
    lines.push("");
  }

  return lines.join("\n");
}
