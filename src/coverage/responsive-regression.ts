// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Evidence, RawFinding } from "../types.js";
import type { MemoryStore } from "../memory/store.js";
import { runVisualRegressionScan } from "./visual-regression.js";

/**
 * Responsive breakpoints for multi-viewport visual regression testing.
 *
 * Inspired by ECC's browser-qa skill which tests at 375px (mobile),
 * 768px (tablet), and 1440px (desktop).
 */
export interface ResponsiveBreakpoint {
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_BREAKPOINTS: ResponsiveBreakpoint[] = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Time in milliseconds to wait for layout to settle after viewport resize. */
const LAYOUT_SETTLE_DELAY_MS = 300;

export interface MultiViewportOptions {
  areaName: string;
  route: string;
  fingerprintHash: string;
  baselineDir: string;
  outputDir: string;
  diffPixelRatioThreshold: number;
  includeAA: boolean;
  fullPage: boolean;
  maskSelectors: string[];
  breakpoints?: ResponsiveBreakpoint[];
  memoryStore?: MemoryStore;
}

/**
 * Run visual regression at multiple viewport sizes.
 *
 * For each breakpoint, resizes the viewport, waits for layout to settle,
 * runs the visual regression scan, then restores the original viewport.
 *
 * Results from all breakpoints are merged into a single findings + evidence array.
 *
 * @param page - Page object (Playwright or Stagehand Page). Uses `any` to accommodate both.
 * @param options - Configuration for multi-viewport testing
 */
export async function runMultiViewportVisualRegression(
  page: any,
  options: MultiViewportOptions
): Promise<{ findings: RawFinding[]; evidence: Evidence[] }> {
  const breakpoints = options.breakpoints ?? DEFAULT_BREAKPOINTS;
  const allFindings: RawFinding[] = [];
  const allEvidence: Evidence[] = [];

  // Save original viewport
  const originalViewport =
    typeof page.viewportSize === "function" ? page.viewportSize() : undefined;

  for (const bp of breakpoints) {
    try {
      // Resize viewport
      if (typeof page.setViewportSize === "function") {
        await page.setViewportSize({ width: bp.width, height: bp.height });
      }

      // Wait for layout to settle after resize
      await new Promise((resolve) => setTimeout(resolve, LAYOUT_SETTLE_DELAY_MS));

      // Use a breakpoint-specific fingerprint so baselines are stored per-viewport
      const bpFingerprintHash = `${options.fingerprintHash}-${bp.name}`;

      const result = await runVisualRegressionScan(page, {
        areaName: `${options.areaName} (${bp.name} ${bp.width}x${bp.height})`,
        route: options.route,
        fingerprintHash: bpFingerprintHash,
        baselineDir: options.baselineDir,
        outputDir: options.outputDir,
        diffPixelRatioThreshold: options.diffPixelRatioThreshold,
        includeAA: options.includeAA,
        fullPage: options.fullPage,
        maskSelectors: options.maskSelectors,
        memoryStore: options.memoryStore,
      });

      // Annotate findings with breakpoint info
      for (const finding of result.findings) {
        finding.title = `${finding.title} [${bp.name} ${bp.width}x${bp.height}]`;
      }

      allFindings.push(...result.findings);
      allEvidence.push(...result.evidence);
    } catch (error) {
      // Viewport resize or visual regression may fail; continue with remaining breakpoints
    }
  }

  // Restore original viewport
  if (originalViewport && typeof page.setViewportSize === "function") {
    try {
      await page.setViewportSize(originalViewport);
    } catch (error) {
      // Best-effort restore; page may have been closed or navigated
    }
  }

  return { findings: allFindings, evidence: allEvidence };
}
