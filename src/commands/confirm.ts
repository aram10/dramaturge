// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConfirmationResult, FindingSeverity } from '../types.js';
import type { DramaturgeConfig } from '../config.js';
import {
  loadFindingReplayManifest,
  readFindingReplayManifest,
  type FindingReplayManifest,
} from '../repro/manifest.js';
import { confirmManifest } from '../repro/replayer.js';
import { createLiveReplayAdapter } from '../repro/live-replay.js';

export type ConfirmOutputFormat = 'markdown' | 'json' | 'short';

export interface ConfirmCommandArgs {
  finding?: string;
  all?: boolean;
  severity?: string;
  fromReport?: string;
  format?: ConfirmOutputFormat;
  configPath?: string;
  profile?: string;
}

export interface ConfirmReplayContext {
  manifest: FindingReplayManifest;
  config?: DramaturgeConfig;
  profile?: string;
}

export interface ConfirmDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
  loadConfig?: (configPath?: string) => DramaturgeConfig;
  replayManifest?: (context: ConfirmReplayContext) => Promise<ConfirmationResult>;
}

function loadReplayConfig(
  args: ConfirmCommandArgs,
  deps: ConfirmDependencies
): DramaturgeConfig | undefined {
  if (!deps.loadConfig) {
    return undefined;
  }

  if (args.configPath) {
    return deps.loadConfig(args.configPath);
  }

  try {
    return deps.loadConfig(undefined);
  } catch {
    return undefined;
  }
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  Critical: 4,
  Major: 3,
  Minor: 2,
  Trivial: 1,
};

const SEVERITY_BY_NAME = new Map<string, FindingSeverity>(
  (Object.keys(SEVERITY_RANK) as FindingSeverity[]).map((severity) => [
    severity.toLowerCase(),
    severity,
  ])
);

function resultExitCode(result: ConfirmationResult): number {
  switch (result.verdict) {
    case 'fixed':
      return 0;
    case 'still_reproducible':
      return 1;
    case 'cannot_confirm':
      return 2;
    case 'changed_surface':
    case 'new_related_issue':
      return 3;
  }
}

function resultsExitCode(results: ConfirmationResult[]): number {
  return Math.max(...results.map(resultExitCode));
}

function renderShortResult(result: ConfirmationResult): string {
  switch (result.verdict) {
    case 'fixed':
      return `${result.findingId} fixed (${result.confidence} confidence)`;
    case 'still_reproducible':
      return `${result.findingId} still reproducible (${result.confidence} confidence)`;
    case 'cannot_confirm':
      return `${result.findingId} cannot confirm (${result.confidence} confidence)`;
    case 'changed_surface':
      return `${result.findingId} changed surface (${result.confidence} confidence)`;
    case 'new_related_issue':
      return `${result.findingId} new related issue (${result.confidence} confidence)`;
  }
}

function renderMarkdownResultDetails(result: ConfirmationResult): string[] {
  const lines = [
    `## ${result.findingId} — ${result.verdict}`,
    `- Replay: ${result.replay.actionsCompleted} of ${result.replay.actionsRequested} actions completed`,
    `- Console errors: ${result.oracleComparison.consoleErrorsCurrent} current / ${result.oracleComparison.consoleErrorsOriginal} original`,
    `- Network failures: ${result.oracleComparison.networkFailuresCurrent} current / ${result.oracleComparison.networkFailuresOriginal} original`,
  ];
  if (result.replay.stoppedReason) {
    lines.push(`- Stopped reason: ${result.replay.stoppedReason}`);
  }
  return lines;
}

function renderMarkdown(results: ConfirmationResult[]): string {
  const verdictCounts = results.reduce<Record<ConfirmationResult['verdict'], number>>(
    (counts, result) => ({ ...counts, [result.verdict]: counts[result.verdict] + 1 }),
    {
      fixed: 0,
      still_reproducible: 0,
      cannot_confirm: 0,
      changed_surface: 0,
      new_related_issue: 0,
    }
  );
  const lines = [
    '# Confirmation Report',
    '',
    `Confirmed ${results.length} finding${results.length === 1 ? '' : 's'}.`,
    `Verdicts: ${Object.entries(verdictCounts)
      .filter(([, count]) => count > 0)
      .map(([verdict, count]) => `${count} ${verdict}`)
      .join(', ')}`,
    '',
    '| ID | Verdict | Confidence | Replay |',
    '|----|---------|------------|--------|',
    ...results.map(
      (result) =>
        `| ${result.findingId} | ${result.verdict} | ${result.confidence} | ${result.replay.actionsCompleted}/${result.replay.actionsRequested} |`
    ),
    '',
    ...results.flatMap((result, index) => [
      ...(index > 0 ? [''] : []),
      ...renderMarkdownResultDetails(result),
    ]),
  ];
  return lines.join('\n');
}

function renderResults(results: ConfirmationResult[], format: ConfirmOutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(results.length === 1 ? results[0] : results, null, 2);
    case 'short':
      return results.map(renderShortResult).join('\n');
    case 'markdown':
      return renderMarkdown(results);
  }
}

function resolveReportDir(cwd: string, fromReport?: string): string {
  if (fromReport) return resolve(cwd, fromReport);

  const reportsRoot = resolve(cwd, './dramaturge-reports');
  if (!existsSync(reportsRoot)) {
    return join(reportsRoot, 'latest');
  }

  const latest = readdirSync(reportsRoot)
    .map((name) => {
      const path = join(reportsRoot, name);
      return { path, stats: statSync(path) };
    })
    .filter((entry) => entry.stats.isDirectory() && existsSync(join(entry.path, 'findings')))
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)[0];

  return latest?.path ?? join(reportsRoot, 'latest');
}

function parseSeverityFilter(value: string): { threshold: FindingSeverity; orHigher: boolean } {
  const normalized = value.trim().toLowerCase();
  const orHigher = normalized.endsWith('+');
  const name = orHigher ? normalized.slice(0, -1) : normalized;
  const threshold = SEVERITY_BY_NAME.get(name);
  if (!threshold) {
    throw new Error('Invalid confirm severity. Must be one of: critical, major, minor, trivial.');
  }
  return { threshold, orHigher };
}

function matchesSeverity(manifest: FindingReplayManifest, severity: string): boolean {
  const filter = parseSeverityFilter(severity);
  const findingSeverity = manifest.finding.severity;
  if (filter.orHigher) {
    return SEVERITY_RANK[findingSeverity] >= SEVERITY_RANK[filter.threshold];
  }
  return findingSeverity === filter.threshold;
}

function loadAllManifests(reportDir: string): FindingReplayManifest[] {
  const findingsDir = join(reportDir, 'findings');
  if (!existsSync(findingsDir)) {
    throw new Error(
      `No replay manifests found. Expected ${findingsDir}. Re-run Dramaturge to emit findings/<id>.json manifests.`
    );
  }

  const manifests = readdirSync(findingsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFindingReplayManifest(join(findingsDir, name)))
    .sort((a, b) => a.finding.id.localeCompare(b.finding.id));
  if (manifests.length === 0) {
    throw new Error(
      `No replay manifests found in ${findingsDir}. Re-run Dramaturge to emit findings/<id>.json manifests.`
    );
  }
  return manifests;
}

function loadTargetManifests(args: ConfirmCommandArgs, reportDir: string): FindingReplayManifest[] {
  if (args.finding) {
    return [loadFindingReplayManifest(reportDir, args.finding)];
  }

  const manifests = loadAllManifests(reportDir);
  if (args.severity) {
    const filtered = manifests.filter((manifest) => matchesSeverity(manifest, args.severity ?? ''));
    if (filtered.length === 0) {
      throw new Error(`No replay manifests matched --severity ${args.severity}.`);
    }
    return filtered;
  }
  return manifests;
}

export async function runConfirmCommand(
  args: ConfirmCommandArgs,
  deps: ConfirmDependencies
): Promise<number> {
  if (!args.finding && !args.all && !args.severity) {
    deps.error(
      'Usage: dramaturge confirm (--finding <id> | --all | --severity <severity[+]>) [--from-report <report-dir>] (defaults to newest ./dramaturge-reports/*)'
    );
    return 1;
  }

  const reportDir = resolveReportDir(deps.cwd, args.fromReport);
  try {
    const config = loadReplayConfig(args, deps);
    const manifests = loadTargetManifests(args, reportDir);
    const liveReplayAdapter = deps.replayManifest
      ? undefined
      : createLiveReplayAdapter({ config, profile: args.profile });
    const results: ConfirmationResult[] = [];
    for (const manifest of manifests) {
      const result = deps.replayManifest
        ? await deps.replayManifest({ manifest, config, profile: args.profile })
        : await confirmManifest(manifest, liveReplayAdapter);
      results.push(result);
    }
    deps.log(renderResults(results, args.format ?? 'markdown'));
    return resultsExitCode(results);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
