// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Page } from '@playwright/test';
import { shortId } from "../constants.js";
import type { Evidence, FindingSeverity, RawFinding } from "../types.js";
import { buildConfirmedFindingMeta } from "../repro/repro.js";

/**
 * Core Web Vitals measurement module.
 *
 * Collects Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS),
 * and Interaction to Next Paint (INP) metrics from a live page, inspired
 * by ECC's browser-qa skill.
 *
 * Thresholds follow Google's "good" ranges:
 *   LCP < 2.5s  |  CLS < 0.1  |  INP < 200ms
 */

export interface WebVitalsResult {
  /** Largest Contentful Paint in milliseconds (null if unavailable). */
  lcp: number | null;
  /** Cumulative Layout Shift score (null if unavailable). */
  cls: number | null;
  /** Interaction to Next Paint in milliseconds (null if unavailable). */
  inp: number | null;
}

export interface WebVitalsThresholds {
  /** Maximum acceptable LCP in milliseconds (default: 2500). */
  lcpMs: number;
  /** Maximum acceptable CLS score (default: 0.1). */
  cls: number;
  /** Maximum acceptable INP in milliseconds (default: 200). */
  inpMs: number;
}

const DEFAULT_THRESHOLDS: WebVitalsThresholds = {
  lcpMs: 2500,
  cls: 0.1,
  inpMs: 200,
};

/**
 * Severity multipliers for threshold calculations.
 * - MINOR_THRESHOLD: 1.5x threshold for minor severity
 * - MAJOR_THRESHOLD: 2.0x threshold for major severity
 * - POOR_THRESHOLD: 2.5x threshold for critical/poor severity
 */
const MINOR_THRESHOLD_MULTIPLIER = 1.5;
const MAJOR_THRESHOLD_MULTIPLIER = 2.0;
const POOR_THRESHOLD_MULTIPLIER = 2.5;

/**
 * Collect Core Web Vitals from a live Playwright page.
 *
 * Uses the browser's PerformanceObserver API to read LCP and CLS entries.
 * INP is approximated from the `first-input` entry or longest event timing.
 */
export async function collectWebVitals(page: Page): Promise<WebVitalsResult> {
  try {
    const metrics = await page.evaluate(() => {
      const result: { lcp: number | null; cls: number | null; inp: number | null } = {
        lcp: null,
        cls: null,
        inp: null,
      };

      // LCP from performance entries
      const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
      if (lcpEntries.length > 0) {
        const lastEntry = lcpEntries[lcpEntries.length - 1] as PerformanceEntry & { startTime: number };
        result.lcp = lastEntry.startTime;
      }

      // CLS from layout-shift entries
      const layoutShiftEntries = performance.getEntriesByType("layout-shift");
      if (layoutShiftEntries.length > 0) {
        let clsValue = 0;
        for (const entry of layoutShiftEntries) {
          const lsEntry = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (!lsEntry.hadRecentInput) {
            clsValue += lsEntry.value;
          }
        }
        result.cls = clsValue;
      }

      // INP approximation from event timing entries or first-input
      const eventEntries = performance.getEntriesByType("event");
      if (eventEntries.length > 0) {
        let maxDuration = 0;
        for (const entry of eventEntries) {
          if (entry.duration > maxDuration) {
            maxDuration = entry.duration;
          }
        }
        if (maxDuration > 0) {
          result.inp = maxDuration;
        }
      }

      if (result.inp === null) {
        const firstInputEntries = performance.getEntriesByType("first-input");
        if (firstInputEntries.length > 0) {
          result.inp = firstInputEntries[0].duration;
        }
      }

      return result;
    });
    return metrics as WebVitalsResult;
  } catch (error) {
    // Best-effort collection; page may not support Performance API
    return { lcp: null, cls: null, inp: null };
  }
}

function mapVitalToSeverity(
  value: number,
  good: number,
  poor: number
): FindingSeverity {
  if (value >= poor) return "Critical";
  if (value >= good * MINOR_THRESHOLD_MULTIPLIER) return "Major";
  if (value >= good) return "Minor";
  return "Trivial";
}

/**
 * Evaluate web vitals against thresholds and produce findings + evidence.
 */
export function evaluateWebVitals(
  vitals: WebVitalsResult,
  route: string,
  areaName: string,
  thresholds: WebVitalsThresholds = DEFAULT_THRESHOLDS
): { findings: RawFinding[]; evidence: Evidence[] } {
  const findings: RawFinding[] = [];
  const evidence: Evidence[] = [];

  const metricsText: string[] = [];
  if (vitals.lcp !== null) metricsText.push(`LCP=${vitals.lcp.toFixed(0)}ms`);
  if (vitals.cls !== null) metricsText.push(`CLS=${vitals.cls.toFixed(3)}`);
  if (vitals.inp !== null) metricsText.push(`INP=${vitals.inp.toFixed(0)}ms`);

  if (metricsText.length === 0) {
    return { findings, evidence };
  }

  const evidenceId = `ev-${shortId()}`;
  evidence.push({
    id: evidenceId,
    type: "screenshot",
    summary: `Core Web Vitals: ${metricsText.join(", ")}`,
    timestamp: new Date().toISOString(),
    areaName,
    relatedFindingIds: [],
  });

  // LCP check
  if (vitals.lcp !== null && vitals.lcp > thresholds.lcpMs) {
    const findingRef = `fid-${shortId()}`;
    evidence[0].relatedFindingIds.push(findingRef);
    findings.push({
      ref: findingRef,
      category: "Performance Issue",
      severity: mapVitalToSeverity(vitals.lcp, thresholds.lcpMs, thresholds.lcpMs * MAJOR_THRESHOLD_MULTIPLIER),
      title: "Largest Contentful Paint exceeds threshold",
      stepsToReproduce: [`Navigate to ${route}`, "Wait for page to fully load"],
      expected: `LCP should be under ${thresholds.lcpMs}ms`,
      actual: `LCP measured at ${vitals.lcp.toFixed(0)}ms`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: "The page should render its largest contentful element within acceptable limits.",
        observation: `LCP was ${vitals.lcp.toFixed(0)}ms, exceeding the ${thresholds.lcpMs}ms threshold.`,
        evidenceChain: [`lcp=${vitals.lcp.toFixed(0)}ms`, `threshold=${thresholds.lcpMs}ms`],
        alternativesConsidered: [
          "Large unoptimized images or fonts may be blocking render.",
          "Server response time may be slow.",
        ],
        suggestedVerification: [
          "Check the Network tab for slow-loading resources.",
          "Verify image optimization and lazy loading.",
        ],
      },
      meta: buildConfirmedFindingMeta({
        route,
        objective: "Measure Core Web Vitals performance",
        breadcrumbs: ["collectWebVitals"],
        evidenceIds: [evidenceId],
      }),
    });
  }

  // CLS check
  if (vitals.cls !== null && vitals.cls > thresholds.cls) {
    const findingRef = `fid-${shortId()}`;
    evidence[0].relatedFindingIds.push(findingRef);
    findings.push({
      ref: findingRef,
      category: "Performance Issue",
      severity: mapVitalToSeverity(vitals.cls, thresholds.cls, thresholds.cls * POOR_THRESHOLD_MULTIPLIER),
      title: "Cumulative Layout Shift exceeds threshold",
      stepsToReproduce: [`Navigate to ${route}`, "Observe layout stability during load"],
      expected: `CLS should be under ${thresholds.cls}`,
      actual: `CLS measured at ${vitals.cls.toFixed(3)}`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: "The page layout should remain stable without unexpected shifts.",
        observation: `CLS was ${vitals.cls.toFixed(3)}, exceeding the ${thresholds.cls} threshold.`,
        evidenceChain: [`cls=${vitals.cls.toFixed(3)}`, `threshold=${thresholds.cls}`],
        alternativesConsidered: [
          "Images or ads without explicit dimensions may cause layout shifts.",
          "Dynamically injected content may push existing elements.",
        ],
        suggestedVerification: [
          "Add explicit width/height attributes to images and iframes.",
          "Reserve space for dynamically loaded content.",
        ],
      },
      meta: buildConfirmedFindingMeta({
        route,
        objective: "Measure Core Web Vitals performance",
        breadcrumbs: ["collectWebVitals"],
        evidenceIds: [evidenceId],
      }),
    });
  }

  // INP check
  if (vitals.inp !== null && vitals.inp > thresholds.inpMs) {
    const findingRef = `fid-${shortId()}`;
    evidence[0].relatedFindingIds.push(findingRef);
    findings.push({
      ref: findingRef,
      category: "Performance Issue",
      severity: mapVitalToSeverity(vitals.inp, thresholds.inpMs, thresholds.inpMs * POOR_THRESHOLD_MULTIPLIER),
      title: "Interaction to Next Paint exceeds threshold",
      stepsToReproduce: [`Navigate to ${route}`, "Interact with the page (click, type)"],
      expected: `INP should be under ${thresholds.inpMs}ms`,
      actual: `INP measured at ${vitals.inp.toFixed(0)}ms`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: "The page should respond to user interactions promptly.",
        observation: `INP was ${vitals.inp.toFixed(0)}ms, exceeding the ${thresholds.inpMs}ms threshold.`,
        evidenceChain: [`inp=${vitals.inp.toFixed(0)}ms`, `threshold=${thresholds.inpMs}ms`],
        alternativesConsidered: [
          "Heavy JavaScript execution may block the main thread during interactions.",
          "Complex DOM updates triggered by event handlers may cause slow paints.",
        ],
        suggestedVerification: [
          "Profile event handlers for long-running JavaScript.",
          "Consider breaking up long tasks with requestIdleCallback or setTimeout.",
        ],
      },
      meta: buildConfirmedFindingMeta({
        route,
        objective: "Measure Core Web Vitals performance",
        breadcrumbs: ["collectWebVitals"],
        evidenceIds: [evidenceId],
      }),
    });
  }

  return { findings, evidence };
}
