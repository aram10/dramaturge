// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scoreFindingQuality } from '../judge/quality-score.js';
import { buildTestFileContent } from '../report/test-gen.js';
import type {
  AreaResult,
  Evidence,
  ExplorationLedger,
  Finding,
  ReplayableAction,
  RunResult,
} from '../types.js';

export interface RegressDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
}

export interface RegressCommandArgs {
  subcommand?: string;
  positional: string[];
  fromReport?: string;
  dryRun?: boolean;
  output?: string;
}

interface SerializedReportFinding {
  id: string;
  category: Finding['category'];
  severity: Finding['severity'];
  area: string;
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  screenshot?: string | null;
  evidenceIds?: string[];
  meta?: Finding['meta'] | null;
  occurrenceCount?: number;
  impactedAreas?: string[];
  occurrences?: Finding['occurrences'];
}

interface SerializedReport {
  meta?: { targetUrl?: string; startTime?: string; endTime?: string; partial?: boolean };
  findings?: SerializedReportFinding[];
  actions?: Array<ReplayableAction & { areaName?: string; route?: string | null }>;
  evidence?: Evidence[];
  coverage?: Array<{ name: string; url?: string | null }>;
  explorationLedger?: ExplorationLedger | null;
}

interface GeneratedTestPreview {
  finding: Finding;
  generated: ReturnType<typeof buildTestFileContent>;
}

function resolveReportDir(cwd: string, fromReport?: string): string {
  if (fromReport) return resolve(cwd, fromReport);

  const reportsRoot = resolve(cwd, './dramaturge-reports');
  if (!existsSync(reportsRoot)) return join(reportsRoot, 'latest');

  const reportDirectories = readdirSync(reportsRoot)
    .map((name) => {
      const path = join(reportsRoot, name);
      return { path, stats: statSync(path) };
    })
    .filter((entry) => entry.stats.isDirectory() && existsSync(join(entry.path, 'report.json')))
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
  return reportDirectories[0]?.path ?? join(reportsRoot, 'latest');
}

function readReport(reportDir: string): SerializedReport {
  const path = join(reportDir, 'report.json');
  if (!existsSync(path)) {
    throw new Error(`No report.json found in ${reportDir}. Run Dramaturge first.`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as SerializedReport;
}

function areaUrl(report: SerializedReport, areaName: string): string | undefined {
  return report.coverage?.find((area) => area.name === areaName)?.url ?? undefined;
}

function deserializeRunResult(report: SerializedReport): RunResult {
  const evidence = report.evidence ?? [];
  const actions = report.actions ?? [];
  const findings = report.findings ?? [];
  const areaNames = Array.from(
    new Set([
      ...(report.coverage?.map((area) => area.name) ?? []),
      ...findings.map((finding) => finding.area),
      ...actions.map((action) => action.areaName).filter((name): name is string => Boolean(name)),
    ])
  );
  const areaResults: AreaResult[] = areaNames.map((name) => ({
    name,
    url: areaUrl(report, name),
    steps: 0,
    findings: findings
      .filter((finding) => finding.area === name)
      .map((finding) => ({
        ref: finding.id,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        stepsToReproduce: finding.stepsToReproduce,
        expected: finding.expected,
        actual: finding.actual,
        ...(finding.screenshot ? { screenshotRef: finding.screenshot } : {}),
        evidenceIds: finding.evidenceIds ?? [],
        ...(finding.meta ? { meta: finding.meta } : {}),
      })),
    replayableActions: actions.filter((action) => action.areaName === name),
    screenshots: new Map(),
    evidence: evidence.filter((item) => item.areaName === name || !item.areaName),
    coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
    pageType: 'unknown',
    status: 'explored',
  }));

  return {
    targetUrl: report.meta?.targetUrl ?? '',
    startTime: new Date(report.meta?.startTime ?? 0),
    endTime: new Date(report.meta?.endTime ?? report.meta?.startTime ?? 0),
    areaResults,
    unexploredAreas: [],
    partial: report.meta?.partial ?? false,
    blindSpots: [],
  };
}

function collectReportFindings(report: SerializedReport): Finding[] {
  return (report.findings ?? []).map((finding) => ({
    ...finding,
    screenshot: finding.screenshot ?? undefined,
    meta: finding.meta ?? undefined,
    occurrenceCount: finding.occurrenceCount ?? finding.occurrences?.length ?? 1,
    impactedAreas: finding.impactedAreas ?? [finding.area],
    occurrences: finding.occurrences ?? [
      {
        area: finding.area,
        route: finding.meta?.repro?.route,
        evidenceIds: finding.evidenceIds ?? [],
        ref: finding.id,
      },
    ],
  }));
}

function findReportFinding(report: SerializedReport, findingId: string): Finding | undefined {
  return collectReportFindings(report).find((finding) => finding.id === findingId);
}

function allEvidence(report: SerializedReport): Evidence[] {
  return report.evidence ?? [];
}

function collectLedgerActions(report: SerializedReport): ReplayableAction[] {
  return (
    report.explorationLedger?.events.flatMap((event) =>
      event.kind === 'action' ? [event.action] : []
    ) ?? []
  );
}

function renderList(report: SerializedReport): string {
  const findings = collectReportFindings(report);
  if (findings.length === 0) {
    return 'No findings in report.';
  }

  const evidence = allEvidence(report);
  const lines = [
    'ID'.padEnd(12) +
      'SEVERITY'.padEnd(10) +
      'QUALITY'.padEnd(10) +
      'PROMOTABLE'.padEnd(12) +
      'TITLE',
  ];
  for (const finding of findings) {
    const quality = scoreFindingQuality({ finding, evidence });
    lines.push(
      finding.id.padEnd(12) +
        finding.severity.padEnd(10) +
        `${quality.total}/100`.padEnd(10) +
        (quality.promotable ? 'yes' : 'no').padEnd(12) +
        finding.title
    );
  }
  return lines.join('\n');
}

function findGeneratedTest(
  report: SerializedReport,
  findingId: string
): GeneratedTestPreview | undefined {
  const finding = findReportFinding(report, findingId);
  if (!finding) {
    return undefined;
  }

  const runResult = deserializeRunResult(report);
  const areaActions = new Map(
    runResult.areaResults.map((area) => [area.name, area.replayableActions ?? []] as const)
  );
  const generated = buildTestFileContent(finding, {
    result: runResult,
    areaActions,
    ledgerActions: collectLedgerActions(report),
  });
  return { finding, generated };
}

function promoteFinding(
  args: RegressCommandArgs,
  report: SerializedReport,
  deps: RegressDependencies
): number {
  const findingId = args.positional[0];
  if (!findingId) {
    deps.error('Usage: dramaturge regress promote <finding-id> --dry-run');
    return 1;
  }
  if (!args.dryRun) {
    deps.error('Only --dry-run promotion is supported in this first slice.');
    return 1;
  }

  const match = findGeneratedTest(report, findingId);
  if (!match) {
    deps.error(`No finding found for ${findingId}.`);
    return 1;
  }

  const evidence = allEvidence(report);
  const quality = scoreFindingQuality({ finding: match.finding, evidence });
  if (!quality.promotable) {
    deps.error(`Finding ${findingId} is not promotable (quality ${quality.total}/100).`);
    return 1;
  }

  deps.log(`// filename: ${match.generated.filename}`);
  deps.log(match.generated.content);
  return 0;
}

export function runRegressCommand(args: RegressCommandArgs, deps: RegressDependencies): number {
  const reportDir = resolveReportDir(deps.cwd, args.fromReport);
  try {
    const report = readReport(reportDir);
    switch (args.subcommand) {
      case 'list':
      case undefined:
        deps.log(renderList(report));
        return 0;
      case 'promote':
        return promoteFinding(args, report, deps);
      default:
        deps.error(`Unknown regress subcommand: ${args.subcommand}`);
        return 1;
    }
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
