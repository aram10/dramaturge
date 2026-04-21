// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Finding, FindingSeverity, RunResult } from '../types.js';
import { collectFindings } from './collector.js';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeXmlAttr(value: string): string {
  // Attribute values additionally strip control characters that are invalid in XML 1.0.
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f)) {
      out += value[i];
    }
  }
  return escapeXml(out);
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function buildFailureBody(finding: Finding): string {
  const sections: string[] = [];
  if (finding.stepsToReproduce.length > 0) {
    sections.push(
      'Steps to reproduce:\n' +
        finding.stepsToReproduce.map((step, idx) => `  ${idx + 1}. ${step}`).join('\n')
    );
  }
  sections.push(`Expected: ${finding.expected}`);
  sections.push(`Actual: ${finding.actual}`);
  if (finding.impactedAreas.length > 0) {
    sections.push(`Impacted areas: ${finding.impactedAreas.join(', ')}`);
  }
  const route = finding.occurrences
    .map((occurrence) => occurrence.route)
    .find((value): value is string => Boolean(value));
  if (route) {
    sections.push(`Route: ${route}`);
  }
  if ((finding.evidenceIds?.length ?? 0) > 0) {
    sections.push(`Evidence: ${finding.evidenceIds!.join(', ')}`);
  }
  return sections.join('\n\n');
}

const SEVERITY_TO_JUNIT_TYPE: Record<FindingSeverity, string> = {
  Critical: 'critical',
  Major: 'major',
  Minor: 'minor',
  Trivial: 'trivial',
};

export function renderJunit(result: RunResult): string {
  const findings = collectFindings(result.areaResults);
  const totalDurationMs = result.endTime.getTime() - result.startTime.getTime();
  const suiteTime = formatSeconds(totalDurationMs);

  const suiteName = `Dramaturge — ${result.targetUrl}`;
  const timestamp = result.startTime.toISOString();

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="${escapeXmlAttr(suiteName)}" tests="${findings.length}" failures="${findings.length}" time="${suiteTime}">`
  );
  lines.push(
    `  <testsuite name="${escapeXmlAttr(suiteName)}" tests="${findings.length}" failures="${findings.length}" errors="0" skipped="0" time="${suiteTime}" timestamp="${escapeXmlAttr(timestamp)}">`
  );

  for (const finding of findings) {
    const classname = `dramaturge.${finding.category.replace(/\s+/g, '_')}`;
    const testName = `${finding.id} ${finding.title}`;
    const failureType = SEVERITY_TO_JUNIT_TYPE[finding.severity];
    const failureMessage = `${finding.category} (${finding.severity}): ${finding.title}`;
    const body = buildFailureBody(finding);

    lines.push(
      `    <testcase classname="${escapeXmlAttr(classname)}" name="${escapeXmlAttr(testName)}" time="0">`
    );
    lines.push(
      `      <failure message="${escapeXmlAttr(failureMessage)}" type="${escapeXmlAttr(failureType)}">${escapeXml(body)}</failure>`
    );
    lines.push('    </testcase>');
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  lines.push('');

  return lines.join('\n');
}
