// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { RunResult, Finding } from '../types.js';
import { collectFindings } from './collector.js';
import { isNodeAffectedByDiff } from '../diff/diff-hints.js';
import type { DiffContext } from '../diff/types.js';
import { ledgerSummary } from '../ledger.js';

function escapeTableCell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

function escapeMarkdownInline(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/[[\]`*_{}()#+!|>]/g, '\\$&')
    .replace(/@/g, '@\u200B')
    .replace(/[\r\n]+/g, ' ');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${remainingSeconds}s`;
}

// --- Section renderers ---

function renderHeader(
  result: RunResult,
  duration: number,
  exploredAreas: RunResult['areaResults'],
  totalSteps: number
): string[] {
  const lines: string[] = [];
  const timestamp = result.startTime.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  lines.push(`# Dramaturge Report — ${timestamp}`);
  if (result.partial) {
    lines.push('> **Warning:** This run was incomplete. Some areas may not have been explored.');
    lines.push('');
  }
  lines.push(`**Target:** ${escapeMarkdownInline(result.targetUrl)}`);
  lines.push(
    `**Duration:** ${formatDuration(duration)} | **Areas explored:** ${exploredAreas.length} | **Total steps:** ${totalSteps}`
  );
  lines.push('');
  return lines;
}

function renderCrossRunSection(result: RunResult): string[] {
  if (!result.crossRunClassification) return [];
  const { summary, resolved } = result.crossRunClassification;
  const lines: string[] = [];
  lines.push('## Changes Since Last Run');
  lines.push(
    `- ${summary.new} new, ${summary.recurring} recurring, ${summary.resolved} resolved, ${summary.flaky} flaky, ${summary.suppressed} suppressed`
  );
  if (resolved.length > 0) {
    lines.push('');
    lines.push('**Resolved findings (present in prior runs, absent now):**');
    for (const entry of resolved) {
      lines.push(
        `- ${escapeMarkdownInline(entry.severity)} ${escapeMarkdownInline(entry.category)}: ${escapeMarkdownInline(entry.title)} (last seen ${escapeMarkdownInline(entry.lastSeenAt)}, ${entry.runCount} prior run(s))`
      );
    }
  }
  lines.push('');
  return lines;
}

interface FindingCategories {
  bugs: Finding[];
  ux: Finding[];
  a11y: Finding[];
  perf: Finding[];
  visual: Finding[];
}

function renderSummarySection(findings: Finding[], categories: FindingCategories): string[] {
  const { bugs, ux, a11y, perf, visual } = categories;
  const lines: string[] = [];
  lines.push('## Summary');
  if (findings.length === 0) {
    lines.push('- No issues found');
  } else {
    if (bugs.length > 0) {
      const severities = bugs.map((b) => b.severity.toLowerCase());
      const breakdown = [...new Set(severities)]
        .map((s) => `${severities.filter((x) => x === s).length} ${s}`)
        .join(', ');
      lines.push(`- ${bugs.length} bug(s) found (${breakdown})`);
    }
    if (ux.length > 0) lines.push(`- ${ux.length} UX concern(s)`);
    if (a11y.length > 0) lines.push(`- ${a11y.length} accessibility issue(s)`);
    if (perf.length > 0) lines.push(`- ${perf.length} performance issue(s)`);
    if (visual.length > 0) lines.push(`- ${visual.length} visual glitch(es)`);
  }
  lines.push('');
  return lines;
}

function renderLedgerSection(result: RunResult): string[] {
  if (!result.explorationLedger) return [];
  const summary = ledgerSummary(result.explorationLedger);
  return [
    '## Exploration ledger',
    '',
    `- Total events: ${summary.total}`,
    `- Actions: ${summary.actions}`,
    `- Evidence: ${summary.evidence}`,
    `- Network: ${summary.network}`,
    `- Findings: ${summary.findings}`,
    `- Model usage: ${summary.modelUsage}`,
    '',
  ];
}

function renderFindingEntry(
  f: Finding,
  result: RunResult,
  diffScope: Map<string, 'changed' | 'unchanged'> | undefined
): string[] {
  const lines: string[] = [];
  const steps = f.stepsToReproduce
    .map((s, i) => `  ${i + 1}. ${escapeMarkdownInline(s)}`)
    .join('\n');
  lines.push(
    `### [${escapeMarkdownInline(f.id)}] ${escapeMarkdownInline(f.severity)}: ${escapeMarkdownInline(f.title)}`
  );
  lines.push(`- **Area:** ${escapeMarkdownInline(f.area)}`);
  const crossRunStatus = result.crossRunClassification?.byFindingId[f.id];
  if (crossRunStatus) {
    const parts = [`status: ${crossRunStatus.status}`];
    if (crossRunStatus.firstSeenAt) parts.push(`first seen ${crossRunStatus.firstSeenAt}`);
    if (crossRunStatus.runCount !== undefined)
      parts.push(`${crossRunStatus.runCount} prior run(s)`);
    if (crossRunStatus.dismissalReason) parts.push(`reason: ${crossRunStatus.dismissalReason}`);
    lines.push(`- **Cross-run:** ${escapeMarkdownInline(parts.join(' | '))}`);
  }
  if (diffScope) {
    const scope = diffScope.get(f.area) ?? 'unchanged';
    lines.push(`- **Diff scope:** ${escapeMarkdownInline(scope)}`);
  }
  lines.push(`- **Category:** ${escapeMarkdownInline(f.category)}`);
  lines.push(`- **Severity:** ${escapeMarkdownInline(f.severity)}`);
  lines.push(`- **Steps to reproduce:**`);
  lines.push(steps);
  lines.push(`- **Expected:** ${escapeMarkdownInline(f.expected)}`);
  lines.push(`- **Actual:** ${escapeMarkdownInline(f.actual)}`);
  renderFindingVerdict(f, lines);
  renderFindingRepro(f, lines);
  lines.push('');
  return lines;
}

function renderFindingVerdict(f: Finding, lines: string[]): void {
  if (!f.verdict) return;
  lines.push(`- **Hypothesis:** ${escapeMarkdownInline(f.verdict.hypothesis)}`);
  lines.push(`- **Observation:** ${escapeMarkdownInline(f.verdict.observation)}`);
  if (f.verdict.evidenceChain.length > 0) {
    lines.push(
      `- **Evidence chain:** ${f.verdict.evidenceChain.map((e) => escapeMarkdownInline(e)).join(' | ')}`
    );
  }
  if (f.verdict.alternativesConsidered.length > 0) {
    lines.push(
      `- **Alternative explanations:** ${f.verdict.alternativesConsidered.map((e) => escapeMarkdownInline(e)).join(' | ')}`
    );
  }
  if (f.verdict.suggestedVerification.length > 0) {
    lines.push(
      `- **Suggested verification:** ${f.verdict.suggestedVerification.map((e) => escapeMarkdownInline(e)).join(' | ')}`
    );
  }
}

function renderFindingReproMeta(
  repro: NonNullable<NonNullable<Finding['meta']>['repro']>,
  lines: string[]
): void {
  if (repro.stateId) lines.push(`- **Repro state:** ${escapeMarkdownInline(repro.stateId)}`);
  if (repro.route) lines.push(`- **Repro route:** ${escapeMarkdownInline(repro.route)}`);
  lines.push(`- **Repro objective:** ${escapeMarkdownInline(repro.objective)}`);
  if (repro.breadcrumbs.length > 0) {
    lines.push(
      `- **Repro breadcrumbs:** ${repro.breadcrumbs.map((c) => escapeMarkdownInline(c)).join(' | ')}`
    );
  }
  if ((repro.actionIds?.length ?? 0) > 0) {
    lines.push(
      `- **Repro action ids:** ${repro.actionIds?.map((id) => escapeMarkdownInline(id)).join(', ')}`
    );
  }
  if (repro.evidenceIds.length > 0) {
    lines.push(
      `- **Repro evidence:** ${repro.evidenceIds.map((id) => escapeMarkdownInline(id)).join(', ')}`
    );
  }
  renderTraceBundleLine(repro, lines);
}

function renderTraceBundleLine(
  repro: NonNullable<NonNullable<Finding['meta']>['repro']>,
  lines: string[]
): void {
  if (!repro.actionIds?.length && !repro.evidenceIds.length) return;
  const actions = repro.actionIds?.map((id) => escapeMarkdownInline(id)).join(', ') || 'none';
  const evidence = repro.evidenceIds.map((id) => escapeMarkdownInline(id)).join(', ') || 'none';
  lines.push(`- **Trace bundle:** actions=${actions} | evidence=${evidence}`);
}

function renderFindingRepro(f: Finding, lines: string[]): void {
  if (f.occurrenceCount > 1) {
    lines.push(`- **Occurrences:** ${f.occurrenceCount}`);
    lines.push(
      `- **Impacted areas:** ${f.impactedAreas.map((area) => escapeMarkdownInline(area)).join(', ')}`
    );
  }
  if (f.screenshot) {
    lines.push(`- **Screenshot:** ${escapeMarkdownInline(f.screenshot)}`);
  }
  if (!f.meta) return;
  lines.push(`- **Source:** ${escapeMarkdownInline(f.meta.source)}`);
  lines.push(`- **Confidence:** ${escapeMarkdownInline(f.meta.confidence)}`);
  if (f.meta.repro) {
    renderFindingReproMeta(f.meta.repro, lines);
  }
}

function renderFindingsSection(
  findings: Finding[],
  result: RunResult,
  diffScope: Map<string, 'changed' | 'unchanged'> | undefined
): string[] {
  if (findings.length === 0) return [];
  const lines: string[] = ['## Findings', ''];
  for (const f of findings) {
    lines.push(...renderFindingEntry(f, result, diffScope));
  }
  return lines;
}

function renderCoverageMapSection(result: RunResult): string[] {
  const lines: string[] = [];
  lines.push('## Coverage Map');
  lines.push('| Area | Page Type | Steps | Findings | Controls (exercised/discovered) | Status |');
  lines.push('|------|-----------|-------|----------|-------------------------------|--------|');
  for (const area of result.areaResults) {
    const coverageStr =
      area.coverage.controlsDiscovered > 0
        ? `${area.coverage.controlsExercised}/${area.coverage.controlsDiscovered}`
        : '—';
    lines.push(
      `| ${escapeTableCell(area.name)} | ${escapeTableCell(area.pageType)} | ${area.steps} | ${area.findings.length} | ${coverageStr} | ${escapeTableCell(area.status)} |`
    );
  }
  lines.push('');
  return lines;
}

function renderCoverageSummarySection(result: RunResult): string[] {
  const totalControlsDiscovered = result.areaResults.reduce(
    (sum, a) => sum + a.coverage.controlsDiscovered,
    0
  );
  const totalControlsExercised = result.areaResults.reduce(
    (sum, a) => sum + a.coverage.controlsExercised,
    0
  );
  if (totalControlsDiscovered === 0) return [];
  const pct = Math.round((totalControlsExercised / totalControlsDiscovered) * 100);
  return [
    '## Coverage Summary',
    `- **Controls discovered:** ${totalControlsDiscovered}`,
    `- **Controls exercised:** ${totalControlsExercised} (${pct}%)`,
    '',
  ];
}

function renderEvidenceIndexSection(
  result: RunResult,
  findingIdByRef: Map<string, string>
): string[] {
  const allEvidence = result.areaResults.flatMap((a) => a.evidence);
  if (allEvidence.length === 0) return [];
  const lines: string[] = [];
  lines.push('## Evidence Index');
  lines.push('| ID | Type | Area | Summary | Path | Related findings |');
  lines.push('|----|------|------|---------|------|------------------|');
  for (const ev of allEvidence) {
    const relatedFindings = Array.from(
      new Set(ev.relatedFindingIds.map((ref) => findingIdByRef.get(ref) ?? ref))
    );
    lines.push(
      `| ${escapeTableCell(ev.id)} | ${escapeTableCell(ev.type)} | ${escapeTableCell(ev.areaName ?? '—')} | ${escapeTableCell(ev.summary)} | ${escapeTableCell(ev.path ?? '—')} | ${escapeTableCell(relatedFindings.join(', ') || '—')} |`
    );
  }
  lines.push('');
  return lines;
}

function renderActionTraceSection(result: RunResult): string[] {
  const allActions = result.areaResults.flatMap((area) =>
    (area.replayableActions ?? []).map((action) => ({ areaName: area.name, ...action }))
  );
  if (allActions.length === 0) return [];
  const lines: string[] = [];
  lines.push('## Action Trace');
  lines.push('| ID | Area | Kind | Source | Summary | Status |');
  lines.push('|----|------|------|--------|---------|--------|');
  for (const action of allActions) {
    lines.push(
      `| ${escapeTableCell(action.id)} | ${escapeTableCell(action.areaName)} | ${escapeTableCell(action.kind)} | ${escapeTableCell(action.source)} | ${escapeTableCell(action.summary)} | ${escapeTableCell(action.status)} |`
    );
  }
  lines.push('');
  return lines;
}

function renderUnexploredAreasSection(result: RunResult): string[] {
  if (result.unexploredAreas.length === 0) return [];
  const lines: string[] = ['## Areas Not Explored'];
  for (const area of result.unexploredAreas) {
    lines.push(`- ${escapeMarkdownInline(area.name)} (${escapeMarkdownInline(area.reason)})`);
  }
  lines.push('');
  return lines;
}

function renderBlindSpotsSection(result: RunResult): string[] {
  if (result.blindSpots.length === 0) return [];
  const lines: string[] = [
    '## Blind Spots',
    'Areas where testing coverage may be incomplete:',
    '',
    '| Severity | Reason | Summary |',
    '|----------|--------|---------|',
  ];
  for (const spot of result.blindSpots) {
    lines.push(
      `| ${escapeTableCell(spot.severity)} | ${escapeTableCell(spot.reason)} | ${escapeTableCell(spot.summary)} |`
    );
  }
  lines.push('');
  return lines;
}

function renderStateGraphSection(result: RunResult): string[] {
  if (!result.stateGraphMermaid) return [];
  return ['## State Graph', '', '```mermaid', result.stateGraphMermaid, '```', ''];
}

function renderDiffSummarySection(
  result: RunResult,
  diffScope: Map<string, 'changed' | 'unchanged'> | undefined
): string[] {
  if (!result.diffSummary) return [];
  const ds = result.diffSummary;
  const lines: string[] = [];
  lines.push('## Diff Summary');
  lines.push(`- **Base ref:** ${escapeMarkdownInline(ds.baseRef)}`);
  lines.push(`- **Changed files:** ${ds.changedFileCount}`);
  lines.push(
    `- **Affected routes:** ${ds.affectedRoutes.length > 0 ? ds.affectedRoutes.map((r) => escapeMarkdownInline(r)).join(', ') : 'none detected'}`
  );
  lines.push(
    `- **Affected API endpoints:** ${ds.affectedApiEndpoints.length > 0 ? ds.affectedApiEndpoints.map((e) => escapeMarkdownInline(e)).join(', ') : 'none detected'}`
  );
  if (diffScope) {
    const changedCount = [...diffScope.values()].filter((v) => v === 'changed').length;
    const unchangedCount = [...diffScope.values()].filter((v) => v === 'unchanged').length;
    lines.push(`- **Areas in changed code paths:** ${changedCount}`);
    lines.push(`- **Areas in unchanged code paths:** ${unchangedCount}`);
  }
  lines.push('');
  return lines;
}

function renderRunMemorySection(result: RunResult): string[] {
  if (!result.runMemory) return [];
  const rm = result.runMemory;
  return [
    `## Run Memory`,
    `- **Enabled:** ${rm.enabled ? 'yes' : 'no'}`,
    `- **Warm start applied:** ${rm.warmStartApplied ? 'yes' : 'no'}`,
    `- **Restored states:** ${rm.restoredStateCount}`,
    `- **Known findings tracked:** ${rm.knownFindingCount}`,
    `- **Suppressed findings:** ${rm.suppressedFindingCount}`,
    `- **Flaky pages noted:** ${rm.flakyPageCount}`,
    `- **Visual baselines tracked:** ${rm.visualBaselineCount}`,
    '',
  ];
}

function renderRunConfigSection(result: RunResult): string[] {
  if (!result.runConfig) return [];
  const rc = result.runConfig;
  const ckpt = rc.checkpointInterval === 0 ? 'disabled' : `every ${rc.checkpointInterval} tasks`;
  return [
    `## Run Configuration`,
    `- **App:** ${escapeMarkdownInline(rc.appDescription)}`,
    `- **Planner model:** ${escapeMarkdownInline(rc.models.planner)}`,
    `- **Worker model:** ${escapeMarkdownInline(rc.models.worker)}`,
    `- **Concurrency:** ${rc.concurrency} worker(s)`,
    `- **Budget:** ${rc.budget.timeLimitSeconds}s time limit, ${rc.budget.maxStepsPerTask} steps/task, ${rc.budget.maxStateNodes} max states`,
    `- **Checkpoint interval:** ${escapeMarkdownInline(ckpt)}`,
    `- **Auto-capture:** ${rc.autoCaptureEnabled ? 'enabled' : 'disabled'}`,
    `- **LLM planner:** ${rc.llmPlannerEnabled ? 'enabled' : 'disabled'}`,
    `- **Memory:** ${rc.memoryEnabled ? 'enabled' : 'disabled'}`,
    `- **Warm start:** ${rc.warmStartEnabled ? 'enabled' : 'disabled'}`,
    `- **Visual regression:** ${rc.visualRegressionEnabled ? 'enabled' : 'disabled'}`,
    '',
  ];
}

function renderSafetyAuditSection(result: RunResult): string[] {
  if (!result.safetyAudit) return [];
  const lines: string[] = [
    '## Safety Guard Audit',
    '',
    `- Blocked actions: ${result.safetyAudit.blockedCount}`,
    `- Audit entries retained: ${result.safetyAudit.entries.length}`,
  ];
  if (result.safetyAudit.entries.length > 0) {
    lines.push(
      '',
      '| Time | Blocked | Action | URL | Reason |',
      '|------|---------|--------|-----|--------|'
    );
    for (const entry of result.safetyAudit.entries.slice(-10)) {
      lines.push(
        `| ${escapeTableCell(entry.timestamp)} | ${entry.blocked ? 'yes' : 'no'} | ${escapeTableCell(entry.action)} | ${escapeTableCell(entry.url)} | ${escapeTableCell(entry.reason)} |`
      );
    }
  }
  lines.push('');
  return lines;
}

// --- Public API ---

export function renderMarkdown(result: RunResult): string {
  const findings = collectFindings(result.areaResults);
  const duration = result.endTime.getTime() - result.startTime.getTime();
  const findingIdByRef = new Map<string, string>();
  const exploredAreas = result.areaResults.filter((a) => a.status === 'explored');
  const totalSteps = result.areaResults.reduce((sum, a) => sum + a.steps, 0);

  for (const finding of findings) {
    for (const occurrence of finding.occurrences) {
      findingIdByRef.set(occurrence.ref, finding.id);
    }
  }

  const diffScope = result.diffSummary ? buildDiffScopeMap(result) : undefined;

  const categories: FindingCategories = {
    bugs: findings.filter((f) => f.category === 'Bug'),
    ux: findings.filter((f) => f.category === 'UX Concern'),
    a11y: findings.filter((f) => f.category === 'Accessibility Issue'),
    perf: findings.filter((f) => f.category === 'Performance Issue'),
    visual: findings.filter((f) => f.category === 'Visual Glitch'),
  };

  const sections: string[][] = [
    renderHeader(result, duration, exploredAreas, totalSteps),
    renderCrossRunSection(result),
    renderSummarySection(findings, categories),
    renderLedgerSection(result),
    renderFindingsSection(findings, result, diffScope),
    renderCoverageMapSection(result),
    renderCoverageSummarySection(result),
    renderEvidenceIndexSection(result, findingIdByRef),
    renderActionTraceSection(result),
    renderUnexploredAreasSection(result),
    renderBlindSpotsSection(result),
    renderStateGraphSection(result),
    renderDiffSummarySection(result, diffScope),
    renderRunMemorySection(result),
    renderRunConfigSection(result),
    renderSafetyAuditSection(result),
  ];

  return sections.flat().join('\n');
}

/**
 * Build a lookup of area name → "changed" | "unchanged" based on the
 * diff summary's affected routes.
 */
function buildDiffScopeMap(result: RunResult): Map<string, 'changed' | 'unchanged'> {
  const map = new Map<string, 'changed' | 'unchanged'>();
  if (!result.diffSummary) return map;

  const diffContext: DiffContext = {
    baseRef: result.diffSummary.baseRef,
    changedFiles: [],
    affectedRoutes: result.diffSummary.affectedRoutes,
    affectedApiEndpoints: result.diffSummary.affectedApiEndpoints,
    affectedRouteFamilies: result.diffSummary.affectedRouteFamilies,
  };

  for (const area of result.areaResults) {
    const affected = isNodeAffectedByDiff(area.url, diffContext);
    map.set(area.name, affected ? 'changed' : 'unchanged');
  }

  return map;
}
