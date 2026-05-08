// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Finding, FindingCategory } from '../types.js';
import type {
  BenchmarkApp,
  BenchmarkMetrics,
  BenchmarkResult,
  FindingClassification,
} from './types.js';

/**
 * Calculate benchmark metrics from findings and classifications.
 */
export function calculateMetrics(
  app: BenchmarkApp,
  findings: Finding[],
  classifications: FindingClassification[],
  runtime: { startTime: number; firstFindingTime?: number; endTime: number }
): BenchmarkMetrics {
  const truePositives = classifications.filter((c) => c.isRealIssue).length;
  const falsePositives = classifications.filter((c) => !c.isRealIssue).length;
  const knownIssuesCaught = classifications.filter((c) => c.matchesKnownIssue).length;
  const knownIssuesMissed = (app.knownIssues?.length ?? 0) - knownIssuesCaught;

  const precision = findings.length === 0 ? 0 : truePositives / findings.length;
  const recall =
    (app.knownIssues?.length ?? 0) === 0 ? 0 : knownIssuesCaught / (app.knownIssues?.length ?? 1);

  const categoriesFound = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.category] = (acc[finding.category] ?? 0) + 1;
    return acc;
  }, {}) as Record<FindingCategory, number>;

  const timeToFirstFinding = runtime.firstFindingTime
    ? runtime.firstFindingTime - runtime.startTime
    : 0;
  const totalRuntime = runtime.endTime - runtime.startTime;

  return {
    appId: app.id,
    totalFindings: findings.length,
    truePositives,
    falsePositives,
    knownIssuesCaught,
    knownIssuesMissed,
    precision,
    recall,
    categoriesFound,
    timeToFirstFinding,
    totalRuntime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Classify a finding as true positive or false positive.
 * This is a simplified version - in practice, requires manual review.
 */
export function classifyFinding(
  finding: Finding,
  knownIssues: BenchmarkApp['knownIssues'] = []
): FindingClassification {
  // Check if this matches a known issue
  const matchedKnownIssue = knownIssues.find((known) => {
    // Match by category and partial description similarity
    if (known.category !== finding.category) {
      return false;
    }

    // Simple keyword matching for now
    const findingTitle = finding.title.toLowerCase();
    const knownDesc = known.description.toLowerCase();
    const keywords = knownDesc.split(/\s+/).filter((w) => w.length > 4);

    return keywords.some((keyword) => findingTitle.includes(keyword));
  });

  return {
    finding,
    isRealIssue: Boolean(matchedKnownIssue) || finding.meta?.confidence !== 'low',
    matchesKnownIssue: Boolean(matchedKnownIssue),
    knownIssueId: matchedKnownIssue?.id,
    notes: matchedKnownIssue ? `Matches known issue: ${matchedKnownIssue.description}` : undefined,
  };
}

/**
 * Generate a benchmark result from findings.
 */
export function generateBenchmarkResult(
  app: BenchmarkApp,
  findings: Finding[],
  runtime: { startTime: number; firstFindingTime?: number; endTime: number }
): BenchmarkResult {
  const classifications = findings.map((finding) => classifyFinding(finding, app.knownIssues));
  const metrics = calculateMetrics(app, findings, classifications, runtime);

  return {
    app,
    metrics,
    classifications,
    rawFindings: findings,
  };
}

/**
 * Format metrics for display.
 */
export function formatMetrics(metrics: BenchmarkMetrics): string {
  const lines: string[] = [
    `Application: ${metrics.appId}`,
    `Timestamp: ${metrics.timestamp}`,
    '',
    '## Summary',
    `Total findings: ${metrics.totalFindings}`,
    `True positives: ${metrics.truePositives}`,
    `False positives: ${metrics.falsePositives}`,
    `Precision: ${(metrics.precision * 100).toFixed(1)}%`,
    '',
    '## Known Issues',
    `Caught: ${metrics.knownIssuesCaught}`,
    `Missed: ${metrics.knownIssuesMissed}`,
    `Recall: ${(metrics.recall * 100).toFixed(1)}%`,
    '',
    '## Categories',
  ];

  for (const [category, count] of Object.entries(metrics.categoriesFound)) {
    lines.push(`${category}: ${count}`);
  }

  lines.push('');
  lines.push('## Performance');
  lines.push(`Time to first finding: ${(metrics.timeToFirstFinding / 1000).toFixed(1)}s`);
  lines.push(`Total runtime: ${(metrics.totalRuntime / 1000).toFixed(1)}s`);

  return lines.join('\n');
}
