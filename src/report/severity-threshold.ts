// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FindingSeverity } from '../types.js';

/** Rank of each severity, higher = more severe. Mirrors `commands/confirm.ts`. */
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

/** Minimal shape of a `report.json` needed to compute the highest severity present. */
export interface SeverityThresholdReport {
  summary?: {
    bySeverity?: Partial<Record<FindingSeverity, number>>;
  };
  findings?: Array<{ severity?: FindingSeverity }>;
}

/**
 * Parse a `--fail-on-severity` (or `--severity`) CLI value like `major` or
 * `critical` into a validated `FindingSeverity`. Throws on invalid input.
 */
export function parseSeverityThreshold(value: string): FindingSeverity {
  const normalized = value.trim().toLowerCase().replace(/\+$/, '');
  const threshold = SEVERITY_BY_NAME.get(normalized);
  if (!threshold) {
    throw new Error(
      `Invalid severity: ${value}. Must be one of: critical, major, minor, trivial.`
    );
  }
  return threshold;
}

/**
 * Determine the highest severity present in a parsed `report.json`, or
 * `undefined` if the report has no findings.
 */
export function computeMaxSeverity(
  report: SeverityThresholdReport
): FindingSeverity | undefined {
  const bySeverity = report.summary?.bySeverity;
  const findings = report.findings ?? [];

  let best: FindingSeverity | undefined;
  const consider = (severity: FindingSeverity | undefined): void => {
    if (!severity) return;
    if (!best || SEVERITY_RANK[severity] > SEVERITY_RANK[best]) {
      best = severity;
    }
  };

  if (bySeverity) {
    for (const severity of Object.keys(bySeverity) as FindingSeverity[]) {
      if ((bySeverity[severity] ?? 0) > 0) consider(severity);
    }
  } else {
    for (const finding of findings) consider(finding.severity);
  }

  return best;
}

/**
 * Check whether `maxSeverity` meets or exceeds `threshold` (both required).
 * Returns `false` when there are no findings (`maxSeverity` is `undefined`).
 */
export function severityMeetsThreshold(
  maxSeverity: FindingSeverity | undefined,
  threshold: FindingSeverity
): boolean {
  if (!maxSeverity) return false;
  return SEVERITY_RANK[maxSeverity] >= SEVERITY_RANK[threshold];
}

/**
 * Find the most recently modified run directory under `baseDir` that
 * contains a `report.json` file. Returns `undefined` if none is found.
 */
export function findLatestReportDir(baseDir: string): string | undefined {
  if (!existsSync(baseDir)) return undefined;

  const latest = readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(baseDir, entry.name))
    .filter((path) => existsSync(join(path, 'report.json')))
    .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  return latest?.path;
}

/**
 * Read and parse the `report.json` at `reportDir`, or `undefined` if it
 * cannot be found/parsed.
 */
export function readReportJson(reportDir: string): SeverityThresholdReport | undefined {
  const reportPath = join(reportDir, 'report.json');
  if (!existsSync(reportPath)) return undefined;
  try {
    return JSON.parse(readFileSync(reportPath, 'utf-8')) as SeverityThresholdReport;
  } catch {
    return undefined;
  }
}
