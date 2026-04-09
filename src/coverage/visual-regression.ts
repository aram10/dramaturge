// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { buildConfirmedFindingMeta } from "../repro/repro.js";
import { shortId } from "../constants.js";
import type { VisualRegressionPage } from "../browser/page-interface.js";
import type { Evidence, FindingSeverity, RawFinding } from "../types.js";
import type { MemoryStore } from "../memory/store.js";

export interface ComparePngBuffersResult {
  diffPixelCount: number;
  diffPixelRatio: number;
  diffBuffer: Buffer;
  width: number;
  height: number;
}

export interface VisualRegressionScanOptions {
  areaName: string;
  route: string;
  fingerprintHash: string;
  baselineDir: string;
  outputDir: string;
  diffPixelRatioThreshold: number;
  includeAA: boolean;
  fullPage: boolean;
  maskSelectors: string[];
  memoryStore?: MemoryStore;
}

function mapDiffRatioToSeverity(ratio: number): FindingSeverity {
  if (ratio >= 0.25) {
    return "Critical";
  }
  if (ratio >= 0.05) {
    return "Major";
  }
  if (ratio >= 0.01) {
    return "Minor";
  }
  return "Trivial";
}

function readPng(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}

export function comparePngBuffers(
  baselineBuffer: Buffer,
  currentBuffer: Buffer,
  includeAA = false
): ComparePngBuffersResult {
  const baseline = readPng(baselineBuffer);
  const current = readPng(currentBuffer);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error("Cannot compare screenshots with different dimensions");
  }

  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixelCount = pixelmatch(
    baseline.data,
    current.data,
    diff.data,
    baseline.width,
    baseline.height,
    {
      includeAA,
    }
  );

  return {
    diffPixelCount,
    diffPixelRatio: diffPixelCount / (baseline.width * baseline.height),
    diffBuffer: PNG.sync.write(diff),
    width: baseline.width,
    height: baseline.height,
  };
}

function createBaselineFilename(fingerprintHash: string, width: number, height: number): string {
  return `${fingerprintHash}-${width}x${height}.png`;
}

function findExistingBaseline(
  baselineDir: string,
  fingerprintHash: string,
  expectedFileName: string
): { path: string; fileName: string; exactMatch: boolean } | null {
  const expectedPath = join(baselineDir, expectedFileName);
  try {
    const files = readdirSync(baselineDir)
      .filter((name) => name === expectedFileName || name.startsWith(`${fingerprintHash}-`))
      .sort();
    if (files.length === 0) {
      return null;
    }

    const exactMatch = files.includes(expectedFileName);
    const fileName = exactMatch ? expectedFileName : files[0];
    return {
      path: exactMatch ? expectedPath : join(baselineDir, fileName),
      fileName,
      exactMatch,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function createDimensionMismatchResult(input: {
  screenshot: Buffer;
  options: VisualRegressionScanOptions;
  baselineFileName: string;
  baselineWidth: number;
  baselineHeight: number;
  currentWidth: number;
  currentHeight: number;
}): { findings: RawFinding[]; evidence: Evidence[] } {
  const {
    screenshot,
    options,
    baselineFileName,
    baselineWidth,
    baselineHeight,
    currentWidth,
    currentHeight,
  } = input;
  const evidenceId = `ev-${shortId()}`;
  const findingRef = `fid-${shortId()}`;
  const screenshotFileName = `${options.fingerprintHash}-dimension-mismatch-${shortId()}.png`;
  const relativeScreenshotPath = `visual-diffs/${screenshotFileName}`;
  writeFileSync(join(options.outputDir, relativeScreenshotPath), screenshot);

  return {
    findings: [
      {
        ref: findingRef,
        category: "Visual Glitch",
        severity: "Major",
        title: "Visual regression dimensions changed",
        stepsToReproduce: [`Navigate to ${options.route}`],
        expected: `The page should match the stored baseline dimensions (${baselineWidth}x${baselineHeight}).`,
        actual: `The current screenshot dimensions changed to ${currentWidth}x${currentHeight}.`,
        evidenceIds: [evidenceId],
        verdict: {
          hypothesis: "The page dimensions should remain visually consistent with the saved baseline.",
          observation: `The saved baseline uses ${baselineWidth}x${baselineHeight}, but the current screenshot is ${currentWidth}x${currentHeight}.`,
          evidenceChain: [
            `baseline=${baselineFileName}`,
            `current=${relativeScreenshotPath}`,
            `baselineDimensions=${baselineWidth}x${baselineHeight}`,
            `currentDimensions=${currentWidth}x${currentHeight}`,
          ],
          alternativesConsidered: [
            "A viewport or rendering configuration change may have altered the screenshot size.",
          ],
          suggestedVerification: [
            `Inspect ${relativeScreenshotPath} alongside ${baselineFileName}.`,
            "Confirm whether the viewport, layout container, or responsive breakpoint changed intentionally.",
          ],
        },
        meta: buildConfirmedFindingMeta({
          route: options.route,
          objective: "Compare the rendered page dimensions against a stored visual baseline",
          breadcrumbs: [`visual baseline comparison for ${options.fingerprintHash}`],
          evidenceIds: [evidenceId],
        }),
      },
    ],
    evidence: [
      {
        id: evidenceId,
        type: "visual-diff",
        summary: `Visual baseline dimensions changed for ${options.areaName} (${baselineWidth}x${baselineHeight} -> ${currentWidth}x${currentHeight})`,
        path: relativeScreenshotPath,
        areaName: options.areaName,
        timestamp: new Date().toISOString(),
        relatedFindingIds: [findingRef],
      },
    ],
  };
}

async function capturePageScreenshot(
  page: VisualRegressionPage,
  fullPage: boolean,
  maskSelectors: string[]
): Promise<Buffer> {
  const locator = typeof page.locator === "function" ? page.locator.bind(page) : undefined;
  const mask = maskSelectors.length > 0 && locator ? maskSelectors.map((selector) => locator(selector)) : undefined;
  return page.screenshot({
    fullPage,
    mask,
  });
}

async function getViewport(
  page: VisualRegressionPage,
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const viewport = typeof page.viewportSize === "function" ? page.viewportSize() : undefined;
  if (viewport?.width && viewport?.height) {
    return viewport;
  }

  const png = readPng(buffer);
  return {
    width: png.width,
    height: png.height,
  };
}

export async function runVisualRegressionScan(
  page: VisualRegressionPage,
  options: VisualRegressionScanOptions
): Promise<{ findings: RawFinding[]; evidence: Evidence[] }> {
  const screenshot = await capturePageScreenshot(page, options.fullPage, options.maskSelectors);
  const { width, height } = await getViewport(page, screenshot);
  const baselineFileName = createBaselineFilename(options.fingerprintHash, width, height);
  const baselinePath = join(options.baselineDir, baselineFileName);

  mkdirSync(options.baselineDir, { recursive: true });
  mkdirSync(join(options.outputDir, "visual-diffs"), { recursive: true });

  const existingBaseline = findExistingBaseline(
    options.baselineDir,
    options.fingerprintHash,
    baselineFileName
  );
  if (!existingBaseline) {
    writeFileSync(baselinePath, screenshot);
    return { findings: [], evidence: [] };
  }

  const baseline = readFileSync(existingBaseline.path);
  const baselinePng = readPng(baseline);
  if (baselinePng.width !== width || baselinePng.height !== height) {
    return createDimensionMismatchResult({
      screenshot,
      options,
      baselineFileName: existingBaseline.fileName,
      baselineWidth: baselinePng.width,
      baselineHeight: baselinePng.height,
      currentWidth: width,
      currentHeight: height,
    });
  }

  try {
    const diff = comparePngBuffers(baseline, screenshot, options.includeAA);
    if (diff.diffPixelRatio < options.diffPixelRatioThreshold) {
      if (diff.diffPixelCount > 0) {
        options.memoryStore?.recordFlakyPage({
          route: options.route,
          fingerprintHash: options.fingerprintHash,
          note: `Visual changes stayed below the configured threshold (${diff.diffPixelCount} pixel(s) changed).`,
          source: "visual-regression",
        });
      }
      return { findings: [], evidence: [] };
    }

    const evidenceId = `ev-${shortId()}`;
    const findingRef = `fid-${shortId()}`;
    const diffFileName = `${options.fingerprintHash}-${shortId()}.png`;
    const relativeDiffPath = `visual-diffs/${diffFileName}`;
    writeFileSync(join(options.outputDir, relativeDiffPath), diff.diffBuffer);

    return {
      findings: [
        {
          ref: findingRef,
          category: "Visual Glitch",
          severity: mapDiffRatioToSeverity(diff.diffPixelRatio),
          title: "Visual regression detected",
          stepsToReproduce: [`Navigate to ${options.route}`],
          expected: "The page should match the stored visual baseline",
          actual: `${diff.diffPixelCount} pixel(s) changed (${(diff.diffPixelRatio * 100).toFixed(2)}% of the page)`,
          evidenceIds: [evidenceId],
          verdict: {
            hypothesis: "The current page render should remain visually consistent with the saved baseline.",
            observation: `${diff.diffPixelCount} pixel(s) changed when compared with the saved baseline.`,
            evidenceChain: [
              `baseline=${baselineFileName}`,
              `diff=${relativeDiffPath}`,
              `diffRatio=${diff.diffPixelRatio.toFixed(4)}`,
            ],
            alternativesConsidered: options.maskSelectors.length > 0
              ? ["Masked selectors were excluded from the screenshot comparison."]
              : [],
            suggestedVerification: [
              `Open ${relativeDiffPath} and compare it against ${baselineFileName}.`,
            ],
          },
          meta: buildConfirmedFindingMeta({
            route: options.route,
            objective: "Compare the rendered page against a stored visual baseline",
            breadcrumbs: [`visual baseline comparison for ${options.fingerprintHash}`],
            evidenceIds: [evidenceId],
          }),
        },
      ],
      evidence: [
        {
          id: evidenceId,
          type: "visual-diff",
          summary: `Visual diff for ${options.areaName} (${(diff.diffPixelRatio * 100).toFixed(2)}% changed)`,
          path: relativeDiffPath,
          areaName: options.areaName,
          timestamp: new Date().toISOString(),
          relatedFindingIds: [findingRef],
        },
      ],
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      writeFileSync(baselinePath, screenshot);
      return { findings: [], evidence: [] };
    }
    throw error;
  }
}
