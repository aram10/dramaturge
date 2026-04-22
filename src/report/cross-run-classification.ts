// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Finding, FindingCategory, FindingSeverity } from '../types.js';
import type { HistoricalFindingRecord, HistoricalFlakyPageRecord } from '../memory/types.js';
import { buildFindingGroupKey } from './collector.js';

export type CrossRunStatus = 'new' | 'recurring' | 'resolved' | 'flaky' | 'suppressed';

export interface CrossRunFindingStatus {
  signature: string;
  status: CrossRunStatus;
  firstSeenAt?: string;
  lastSeenAt?: string;
  runCount?: number;
  dismissalReason?: string;
}

export interface ResolvedFindingRecord {
  signature: string;
  title: string;
  category: FindingCategory;
  severity: FindingSeverity;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
}

export interface CrossRunSummary {
  new: number;
  recurring: number;
  resolved: number;
  flaky: number;
  suppressed: number;
}

export interface CrossRunClassification {
  /** Status for findings in the current run, keyed by Finding.id. */
  byFindingId: Record<string, CrossRunFindingStatus>;
  /** Prior findings whose signatures are not present in the current run. */
  resolved: ResolvedFindingRecord[];
  summary: CrossRunSummary;
}

function normalizeRoute(urlOrPath?: string): string | undefined {
  if (!urlOrPath) {
    return undefined;
  }
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  }
}

function findingIsFlaky(finding: Finding, flakyPages: HistoricalFlakyPageRecord[]): boolean {
  if (flakyPages.length === 0) {
    return false;
  }
  const candidateRoutes = new Set<string>();
  for (const occurrence of finding.occurrences) {
    const route = normalizeRoute(occurrence.route);
    if (route) candidateRoutes.add(route);
  }
  const reproRoute = normalizeRoute(finding.meta?.repro?.route);
  if (reproRoute) candidateRoutes.add(reproRoute);
  if (candidateRoutes.size === 0) {
    return false;
  }
  return flakyPages.some((page) => {
    const pageRoute = normalizeRoute(page.route);
    return Boolean(pageRoute && candidateRoutes.has(pageRoute));
  });
}

export function classifyFindings(
  findings: Finding[],
  findingHistory: Record<string, HistoricalFindingRecord>,
  flakyPages: HistoricalFlakyPageRecord[] = []
): CrossRunClassification {
  const byFindingId: Record<string, CrossRunFindingStatus> = {};
  const currentSignatures = new Set<string>();
  const summary: CrossRunSummary = {
    new: 0,
    recurring: 0,
    resolved: 0,
    flaky: 0,
    suppressed: 0,
  };

  for (const finding of findings) {
    const signature = buildFindingGroupKey(finding);
    currentSignatures.add(signature);
    const record = findingHistory[signature];

    let status: CrossRunStatus;
    if (record?.suppressed) {
      status = 'suppressed';
    } else if (findingIsFlaky(finding, flakyPages)) {
      status = 'flaky';
    } else if (record) {
      status = 'recurring';
    } else {
      status = 'new';
    }

    summary[status] += 1;

    byFindingId[finding.id] = {
      signature,
      status,
      firstSeenAt: record?.firstSeenAt,
      lastSeenAt: record?.lastSeenAt,
      runCount: record?.runCount,
      dismissalReason: record?.dismissalReason,
    };
  }

  const resolved: ResolvedFindingRecord[] = [];
  for (const record of Object.values(findingHistory)) {
    if (currentSignatures.has(record.signature)) continue;
    if (record.suppressed) continue;
    resolved.push({
      signature: record.signature,
      title: record.title,
      category: record.category,
      severity: record.severity,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      runCount: record.runCount,
    });
  }
  summary.resolved = resolved.length;

  return {
    byFindingId,
    resolved,
    summary,
  };
}
