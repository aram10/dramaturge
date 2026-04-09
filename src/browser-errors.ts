// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import type {
  RawFinding,
  Evidence,
  BrowserConsoleError,
  BrowserNetworkError,
  BrowserPageError,
} from './types.js';
import { shortId, TRUNCATE_GROUP_KEY, TRUNCATE_SUMMARY, TRUNCATE_TITLE } from './constants.js';
import type { PolicyConfig } from './policy/types.js';
import { shouldSuppressFinding } from './policy/policy.js';
import { buildAutoCaptureFindingMeta } from './repro/repro.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

export interface BrowserErrorCollectorOptions {
  captureConsole: boolean;
  captureConsoleWarnings: boolean;
  captureNetwork: boolean;
  networkErrorMinStatus: number;
  policy?: PolicyConfig;
}

interface ErrorBucket {
  consoleErrors: BrowserConsoleError[];
  networkErrors: BrowserNetworkError[];
  pageErrors: BrowserPageError[];
}

/** Auto-captures console errors, uncaught exceptions, and network failures from browser pages. */
export class BrowserErrorCollector {
  private buckets = new Map<string, ErrorBucket>();
  private options: BrowserErrorCollectorOptions;
  private teardownFns = new Map<string, Array<() => void>>();

  constructor(options: BrowserErrorCollectorOptions) {
    this.options = options;
  }

  /** Attach event listeners to a page. Safe to call for multiple pages. */
  attach(page: StagehandPage, pageKey = 'default'): void {
    if (this.teardownFns.has(pageKey)) {
      this.detach(pageKey);
    }
    // Stagehand's Page type only exposes a subset of Playwright events,
    const p = page as any;
    const bucket = this.getBucket(pageKey);
    const teardowns = this.teardownFns.get(pageKey) ?? [];

    if (this.options.captureConsole || this.options.captureConsoleWarnings) {
      const onConsole = (msg: { type: () => string; text: () => string }) => {
        const type = msg.type();
        const shouldCapture =
          (type === 'error' && this.options.captureConsole) ||
          (type === 'warning' && this.options.captureConsoleWarnings);
        if (shouldCapture) {
          bucket.consoleErrors.push({
            level: type as 'error' | 'warning',
            text: msg.text(),
            url: page.url(),
            timestamp: new Date().toISOString(),
          });
        }
      };
      p.on('console', onConsole);
      teardowns.push(() => p.off('console', onConsole));
    }

    if (this.options.captureConsole) {
      const onPageError = (error: Error) => {
        bucket.pageErrors.push({
          message: error.message,
          url: page.url(),
          timestamp: new Date().toISOString(),
        });
      };
      p.on('pageerror', onPageError);
      teardowns.push(() => p.off('pageerror', onPageError));
    }

    if (this.options.captureNetwork) {
      const minStatus = this.options.networkErrorMinStatus;
      const onResponse = (response: {
        status: () => number;
        url: () => string;
        statusText: () => string;
        request: () => { method: () => string };
      }) => {
        const status = response.status();
        if (status >= minStatus) {
          bucket.networkErrors.push({
            method: response.request().method(),
            url: response.url(),
            status,
            statusText: response.statusText(),
            timestamp: new Date().toISOString(),
          });
        }
      };
      p.on('response', onResponse);
      teardowns.push(() => p.off('response', onResponse));

      const onRequestFailed = (request: {
        url: () => string;
        method: () => string;
        failure: () => { errorText: string } | null;
      }) => {
        const failure = request.failure();
        if (failure) {
          bucket.networkErrors.push({
            method: request.method(),
            url: request.url(),
            status: 0,
            statusText: failure.errorText,
            timestamp: new Date().toISOString(),
          });
        }
      };
      p.on('requestfailed', onRequestFailed);
      teardowns.push(() => p.off('requestfailed', onRequestFailed));
    }

    this.teardownFns.set(pageKey, teardowns);
  }

  detach(pageKey?: string): void {
    if (pageKey) {
      const teardowns = this.teardownFns.get(pageKey) ?? [];
      for (const fn of teardowns) fn();
      this.teardownFns.delete(pageKey);
      return;
    }

    for (const teardowns of this.teardownFns.values()) {
      for (const fn of teardowns) fn();
    }
    this.teardownFns.clear();
  }

  /** Drain captured errors into findings + evidence, clearing internal buffers. */
  flush(pageKey = 'default'): { findings: RawFinding[]; evidence: Evidence[] } {
    const findings: RawFinding[] = [];
    const evidence: Evidence[] = [];
    const bucket = this.getBucket(pageKey);

    const emit = (
      evidenceType: Evidence['type'],
      summary: string,
      timestamp: string,
      finding: Omit<RawFinding, 'evidenceIds' | 'meta'>,
      metaFactory?: (evidenceIds: string[]) => RawFinding['meta']
    ) => {
      const evidenceId = `ev-${shortId()}`;
      const findingRef = `fid-${shortId()}`;
      evidence.push({
        id: evidenceId,
        type: evidenceType,
        summary,
        timestamp,
        relatedFindingIds: [findingRef],
      });
      findings.push({
        ref: findingRef,
        ...finding,
        evidenceIds: [evidenceId],
        meta: metaFactory?.([evidenceId]),
      });
    };

    // Group console errors by message to avoid duplicate findings
    const consoleMsgs = new Map<string, BrowserConsoleError[]>();
    for (const err of bucket.consoleErrors) {
      const key = err.text.slice(0, TRUNCATE_GROUP_KEY);
      const group = consoleMsgs.get(key) ?? [];
      group.push(err);
      consoleMsgs.set(key, group);
    }

    for (const [msg, errors] of consoleMsgs) {
      const first = errors[0];
      if (
        this.options.policy &&
        shouldSuppressFinding({ type: 'console', error: first }, this.options.policy)
      ) {
        continue;
      }
      emit(
        'console-error',
        `${first.level}: ${msg.slice(0, TRUNCATE_SUMMARY)}`,
        first.timestamp,
        {
          category: 'Bug',
          severity: first.level === 'error' ? 'Major' : 'Minor',
          title: `Browser console ${first.level}: ${msg.slice(0, TRUNCATE_TITLE)}`,
          stepsToReproduce: [`Navigate to ${first.url}`],
          expected: 'No console errors',
          actual: `${errors.length} occurrence(s): ${msg.slice(0, TRUNCATE_GROUP_KEY)}`,
        },
        (evidenceIds) =>
          buildAutoCaptureFindingMeta({
            route: first.url,
            objective: 'Observe auto-captured browser failure',
            confidence: first.level === 'error' ? 'high' : 'medium',
            breadcrumbs: [`auto-captured console ${first.level}`],
            evidenceIds,
          })
      );
    }

    // Page errors (uncaught exceptions)
    for (const err of bucket.pageErrors) {
      if (
        this.options.policy &&
        shouldSuppressFinding({ type: 'console', error: err }, this.options.policy)
      ) {
        continue;
      }
      emit(
        'console-error',
        `Uncaught: ${err.message.slice(0, TRUNCATE_SUMMARY)}`,
        err.timestamp,
        {
          category: 'Bug',
          severity: 'Critical',
          title: `Uncaught exception: ${err.message.slice(0, TRUNCATE_TITLE)}`,
          stepsToReproduce: [`Navigate to ${err.url}`],
          expected: 'No uncaught exceptions',
          actual: err.message,
        },
        (evidenceIds) =>
          buildAutoCaptureFindingMeta({
            route: err.url,
            objective: 'Observe auto-captured browser failure',
            confidence: 'high',
            breadcrumbs: ['auto-captured uncaught exception'],
            evidenceIds,
          })
      );
    }

    // Group network errors by URL+status
    const networkMsgs = new Map<string, BrowserNetworkError[]>();
    for (const err of bucket.networkErrors) {
      const key = `${err.method} ${err.url} ${err.status}`;
      const group = networkMsgs.get(key) ?? [];
      group.push(err);
      networkMsgs.set(key, group);
    }

    for (const [, errors] of networkMsgs) {
      const first = errors[0];
      if (
        this.options.policy &&
        shouldSuppressFinding({ type: 'network', error: first }, this.options.policy)
      ) {
        continue;
      }
      const statusLabel = first.status === 0 ? 'failed' : `${first.status}`;
      let pathname: string;
      try {
        pathname = new URL(first.url).pathname;
      } catch {
        pathname = first.url;
      }
      emit(
        'network-error',
        `${first.method} ${first.url} → ${statusLabel}`,
        first.timestamp,
        {
          category: 'Bug',
          severity: first.status >= 500 ? 'Major' : 'Minor',
          title: `Network ${statusLabel}: ${first.method} ${pathname}`,
          stepsToReproduce: [`Request: ${first.method} ${first.url}`],
          expected: 'Successful HTTP response (2xx/3xx)',
          actual: `${errors.length} occurrence(s): ${first.status} ${first.statusText}`,
        },
        (evidenceIds) =>
          buildAutoCaptureFindingMeta({
            route: first.url,
            objective: 'Observe auto-captured browser failure',
            confidence: first.status === 0 || first.status >= 500 ? 'high' : 'medium',
            breadcrumbs: [`auto-captured ${first.method} ${pathname} -> ${statusLabel}`],
            evidenceIds,
          })
      );
    }

    // Clear captured data
    bucket.consoleErrors = [];
    bucket.networkErrors = [];
    bucket.pageErrors = [];

    return { findings, evidence };
  }

  pendingCount(pageKey = 'default'): number {
    const bucket = this.getBucket(pageKey);
    return bucket.consoleErrors.length + bucket.networkErrors.length + bucket.pageErrors.length;
  }

  private getBucket(pageKey: string): ErrorBucket {
    let bucket = this.buckets.get(pageKey);
    if (!bucket) {
      bucket = {
        consoleErrors: [],
        networkErrors: [],
        pageErrors: [],
      };
      this.buckets.set(pageKey, bucket);
    }
    return bucket;
  }
}
