// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ConfirmationResult } from '../types.js';
import { loadFindingReplayManifest, type FindingReplayManifest } from '../repro/manifest.js';
import { confirmManifest } from '../repro/replayer.js';

export type ConfirmOutputFormat = 'markdown' | 'json' | 'short';

export interface ConfirmCommandArgs {
  finding?: string;
  fromReport?: string;
  format?: ConfirmOutputFormat;
  configPath?: string;
  profile?: string;
}

export interface ConfirmReplayContext {
  manifest: FindingReplayManifest;
  config?: unknown;
  profile?: string;
}

export interface ConfirmDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
  loadConfig?: (configPath?: string) => unknown;
  replayManifest?: (context: ConfirmReplayContext) => Promise<ConfirmationResult>;
}

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

function renderShort(result: ConfirmationResult): string {
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

function renderMarkdown(result: ConfirmationResult): string {
  const lines = [
    '# Confirmation Report',
    '',
    '| ID | Verdict | Confidence | Replay |',
    '|----|---------|------------|--------|',
    `| ${result.findingId} | ${result.verdict} | ${result.confidence} | ${result.replay.actionsCompleted}/${result.replay.actionsRequested} |`,
    '',
    `## ${result.findingId} — ${result.verdict}`,
    `- Replay: ${result.replay.actionsCompleted} of ${result.replay.actionsRequested} actions completed`,
    `- Console errors: ${result.oracleComparison.consoleErrorsCurrent} current / ${result.oracleComparison.consoleErrorsOriginal} original`,
    `- Network failures: ${result.oracleComparison.networkFailuresCurrent} current / ${result.oracleComparison.networkFailuresOriginal} original`,
  ];
  if (result.replay.stoppedReason) {
    lines.push(`- Stopped reason: ${result.replay.stoppedReason}`);
  }
  return lines.join('\n');
}

function renderResult(result: ConfirmationResult, format: ConfirmOutputFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(result, null, 2);
    case 'short':
      return renderShort(result);
    case 'markdown':
      return renderMarkdown(result);
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

export async function runConfirmCommand(
  args: ConfirmCommandArgs,
  deps: ConfirmDependencies
): Promise<number> {
  if (!args.finding) {
    deps.error(
      'Usage: dramaturge confirm --finding <id> [--from-report <report-dir>] (defaults to newest ./dramaturge-reports/*)'
    );
    return 1;
  }

  const reportDir = resolveReportDir(deps.cwd, args.fromReport);
  try {
    const config = args.configPath ? deps.loadConfig?.(args.configPath) : undefined;
    const manifest = loadFindingReplayManifest(reportDir, args.finding);
    const result = deps.replayManifest
      ? await deps.replayManifest({ manifest, config, profile: args.profile })
      : await confirmManifest(manifest);
    deps.log(renderResult(result, args.format ?? 'markdown'));
    return resultExitCode(result);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
