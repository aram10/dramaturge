// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Finding, FindingCategory, FindingSeverity } from '../types.js';
import type { HistoricalFindingRecord, HistoricalFlakyPageRecord } from '../memory/types.js';
import { buildFindingGroupKey } from './collector.js';
import { MIN_FLAKY_PAGE_COUNT } from '../constants.js';

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

function isSuppressedRecord(record?: HistoricalFindingRecord): boolean {
  return Boolean(record?.suppressed || record?.dismissedAt);
}

/**
 * The category whose findings a flaky-page record is allowed to suppress.
 * Flaky pages are only ever recorded from sub-threshold visual jitter
 * (source: 'visual-regression'), so flakiness must be scoped to visual
 * findings — a functional Bug on a page with minor pixel jitter must not be
 * de-emphasized (#230).
 */
const FLAKY_SUPPRESSIBLE_CATEGORY: FindingCategory = 'Visual Glitch';

function buildFlakyRouteSet(flakyPages: HistoricalFlakyPageRecord[]): Set<string> {
  const flakyRoutes = new Set<string>();
  for (const page of flakyPages) {
    // Require a minimum flaky count before a route influences classification
    // so a one-off below-threshold diff does not taint the page (#230).
    if (page.count < MIN_FLAKY_PAGE_COUNT) {
      continue;
    }
    const route = normalizeRoute(page.route);
    if (route) {
      flakyRoutes.add(route);
    }
  }
  return flakyRoutes;
}

function findingIsFlaky(finding: Finding, flakyRoutes: Set<string>): boolean {
  if (flakyRoutes.size === 0) {
    return false;
  }
  // Flaky suppression is scoped to the category that was actually flaky
  // (visual). Functional/a11y/perf findings are never suppressed by visual
  // jitter on the same route (#230).
  if (finding.category !== FLAKY_SUPPRESSIBLE_CATEGORY) {
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
  return [...candidateRoutes].some((route) => flakyRoutes.has(route));
}

export function classifyFindings(
  findings: Finding[],
  findingHistory: Record<string, HistoricalFindingRecord>,
  flakyPages: HistoricalFlakyPageRecord[] = [],
  options: {
    includeResolved?: boolean;
  } = {}
): CrossRunClassification {
  const includeResolved = options.includeResolved ?? true;
  const byFindingId: Record<string, CrossRunFindingStatus> = {};
  const currentSignatures = new Set<string>();
  const flakyRoutes = buildFlakyRouteSet(flakyPages);
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
    if (isSuppressedRecord(record)) {
      status = 'suppressed';
    } else if (findingIsFlaky(finding, flakyRoutes)) {
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
  if (includeResolved) {
    for (const record of Object.values(findingHistory)) {
      if (currentSignatures.has(record.signature)) continue;
      if (isSuppressedRecord(record)) continue;
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
  }
  summary.resolved = resolved.length;

  return {
    byFindingId,
    resolved,
    summary,
  };
}
