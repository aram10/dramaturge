// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Parses a Dramaturge JSON report and sets GitHub Actions outputs.
 *
 * Usage: node parse-results.js <report-base-dir> [fail-on-severity]
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   report-path        – path to the report run directory
 *   finding-count      – total number of findings
 *   max-severity       – highest severity found (Critical/Major/Minor/Trivial/none)
 *   threshold-exceeded – "true" if max severity meets or exceeds the threshold
 *   summary-path       – path to the generated PR comment markdown
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Severity levels ordered from most to least severe. */
const SEVERITY_ORDER = ['Critical', 'Major', 'Minor', 'Trivial'];

/** Numeric rank for each severity (lower = more severe). */
const SEVERITY_RANK = { Critical: 0, Major: 1, Minor: 2, Trivial: 3 };

/** Emoji icons for each severity level. */
const SEVERITY_ICON = {
  Critical: '\u{1F534}',
  Major: '\u{1F7E0}',
  Minor: '\u{1F7E1}',
  Trivial: '\u26AA',
};

/**
 * Finds the most recent timestamped report directory that contains
 * a report.json file.
 */
export function findLatestReportDir(baseDir) {
  if (!existsSync(baseDir)) return null;
  const entries = readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const entry of entries) {
    const reportPath = join(baseDir, entry, 'report.json');
    if (existsSync(reportPath)) return join(baseDir, entry);
  }
  return null;
}

/** Reads and parses a JSON report file. */
export function parseReport(reportPath) {
  const raw = readFileSync(reportPath, 'utf-8');
  return JSON.parse(raw);
}

/** Formats a duration in milliseconds to a human-readable string. */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  return `${seconds}s`;
}

function escapeMarkdownInline(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/[[\]`*_{}()#+!|>]/g, '\\$&')
    .replace(/@/g, '@\u200B')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * Builds a markdown summary and extracts key metrics from a parsed report.
 *
 * @returns {{ markdown: string, totalFindings: number, maxSeverity: string, bySeverity: Record<string,number> }}
 */
export function buildSummary(report) {
  const meta = report.meta || {};
  const summary = report.summary || {};
  const findings = report.findings || [];

  let bySeverity = summary.bySeverity;
  if (!bySeverity) {
    // Compute severity counts from the findings array when the summary
    // block does not include pre-computed counts.
    bySeverity = { Critical: 0, Major: 0, Minor: 0, Trivial: 0 };
    for (const f of findings) {
      if (f.severity && bySeverity[f.severity] !== undefined) {
        bySeverity[f.severity]++;
      }
    }
  }
  const totalFindings = summary.totalFindings ?? findings.length;

  // Determine highest severity present
  let maxSeverity = 'none';
  for (const sev of SEVERITY_ORDER) {
    if ((bySeverity[sev] || 0) > 0) {
      maxSeverity = sev;
      break;
    }
  }

  const topFindings = findings.slice(0, 10);

  const duration = meta.durationMs ? formatDuration(meta.durationMs) : 'unknown';

  let md = `## \u{1F3AD} Dramaturge QA Report\n\n`;
  md += `**Target:** ${escapeMarkdownInline(meta.targetUrl || 'unknown')}  \n`;
  md += `**Duration:** ${duration}  \n`;

  if (totalFindings === 0) {
    md += `**Status:** \u2705 No findings\n`;
  } else {
    md += `**Status:** \u26A0\uFE0F ${totalFindings} finding${totalFindings !== 1 ? 's' : ''}\n`;
  }

  md += `\n### Summary\n\n`;
  md += `| Severity | Count |\n`;
  md += `|----------|-------|\n`;
  for (const sev of SEVERITY_ORDER) {
    md += `| ${SEVERITY_ICON[sev]} ${sev} | ${bySeverity[sev] || 0} |\n`;
  }

  if (topFindings.length > 0) {
    md += `\n### Top Findings\n\n`;
    for (const f of topFindings) {
      md += `- **${escapeMarkdownInline(f.id)}** (${escapeMarkdownInline(f.severity)}) \u2014 ${escapeMarkdownInline(f.title)}\n`;
    }
  }

  if ((summary.areasExplored ?? 0) > 0) {
    md += `\n---\n_Explored ${summary.areasExplored} areas with ${summary.totalSteps || 0} steps._\n`;
  }

  return { markdown: md, totalFindings, maxSeverity, bySeverity };
}

/**
 * Checks whether the maximum finding severity meets or exceeds a threshold.
 *
 * @param {string} maxSeverity  – the highest severity found (e.g. "Critical")
 * @param {string} threshold    – the threshold input (case-insensitive)
 * @returns {boolean} true when findings meet or exceed the threshold
 */
export function checkSeverityThreshold(maxSeverity, threshold) {
  if (!threshold || maxSeverity === 'none') return false;
  const normalized = threshold.charAt(0).toUpperCase() + threshold.slice(1).toLowerCase();
  const maxRank = SEVERITY_RANK[maxSeverity];
  const thresholdRank = SEVERITY_RANK[normalized];
  if (maxRank === undefined || thresholdRank === undefined) return false;
  // Lower rank number = more severe; exceeds when maxRank <= thresholdRank
  return maxRank <= thresholdRank;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

function main() {
  const reportBaseDir = process.argv[2];
  const failOnSeverity = process.argv[3] || '';

  if (!reportBaseDir) {
    console.error('Usage: parse-results.js <report-base-dir> [fail-on-severity]');
    process.exit(1);
  }

  const reportDir = findLatestReportDir(reportBaseDir);
  if (!reportDir) {
    console.log('No Dramaturge report found in ' + reportBaseDir);
    setOutput('report-path', reportBaseDir);
    setOutput('finding-count', '0');
    setOutput('max-severity', 'none');
    setOutput('threshold-exceeded', 'false');
    setOutput('summary-path', '');
    return;
  }

  const reportPath = join(reportDir, 'report.json');
  const report = parseReport(reportPath);
  const { markdown, totalFindings, maxSeverity } = buildSummary(report);

  // Write the PR-comment markdown next to the report
  const summaryPath = join(reportDir, 'pr-comment.md');
  writeFileSync(summaryPath, markdown, 'utf-8');

  // Check severity threshold
  const exceeded = checkSeverityThreshold(maxSeverity, failOnSeverity);

  // Set GitHub Actions outputs
  setOutput('report-path', reportDir);
  setOutput('finding-count', String(totalFindings));
  setOutput('max-severity', maxSeverity);
  setOutput('threshold-exceeded', String(exceeded));
  setOutput('summary-path', summaryPath);

  console.log(`Report: ${reportDir}`);
  console.log(`Findings: ${totalFindings} (max severity: ${maxSeverity})`);
  if (exceeded) {
    console.log(`\u26A0\uFE0F  Severity threshold '${failOnSeverity}' exceeded`);
  }
}

// Run main when executed directly (not imported for testing)
if (typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
