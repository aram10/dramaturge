import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { buildConfirmedFindingMeta } from "../repro/repro.js";
import { shortId } from "../constants.js";
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

async function capturePageScreenshot(
  page: any,
  fullPage: boolean,
  maskSelectors: string[]
): Promise<Buffer> {
  const mask =
    maskSelectors.length > 0 && typeof page.locator === "function"
      ? maskSelectors.map((selector) => page.locator(selector))
      : undefined;
  return page.screenshot({
    fullPage,
    mask,
  });
}

async function getViewport(page: any, buffer: Buffer): Promise<{ width: number; height: number }> {
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
  page: any,
  options: VisualRegressionScanOptions
): Promise<{ findings: RawFinding[]; evidence: Evidence[] }> {
  const screenshot = await capturePageScreenshot(page, options.fullPage, options.maskSelectors);
  const { width, height } = await getViewport(page, screenshot);
  const baselineFileName = createBaselineFilename(options.fingerprintHash, width, height);
  const baselinePath = join(options.baselineDir, baselineFileName);

  mkdirSync(options.baselineDir, { recursive: true });
  mkdirSync(join(options.outputDir, "visual-diffs"), { recursive: true });

  try {
    const baseline = readFileSync(baselinePath);
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
  } catch {
    writeFileSync(baselinePath, screenshot);
    return { findings: [], evidence: [] };
  }
}
