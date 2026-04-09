// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { VisualRegressionPage } from "../browser/page-interface.js";
import { comparePngBuffers, runVisualRegressionScan } from "./visual-regression.js";

function makeSolidPng(
  color: [number, number, number, number],
  width = 4,
  height = 4
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return PNG.sync.write(png);
}

function createMockPage(buffer: Buffer): VisualRegressionPage {
  const png = PNG.sync.read(buffer);
  return {
    async screenshot() {
      return buffer;
    },
    viewportSize() {
      return { width: png.width, height: png.height };
    },
    locator(selector: string) {
      return {
        selector,
        click: async () => undefined,
        count: async () => 1,
        fill: async () => undefined,
        waitFor: async () => undefined,
      };
    },
  };
}

describe("comparePngBuffers", () => {
  it("returns zero diff for identical screenshots", () => {
    const baseline = makeSolidPng([20, 40, 60, 255]);
    const result = comparePngBuffers(baseline, baseline);

    expect(result.diffPixelCount).toBe(0);
    expect(result.diffPixelRatio).toBe(0);
  });

  it("measures visible pixel differences", () => {
    const baseline = makeSolidPng([20, 40, 60, 255]);
    const changed = makeSolidPng([240, 10, 10, 255]);
    const result = comparePngBuffers(baseline, changed);

    expect(result.diffPixelCount).toBeGreaterThan(0);
    expect(result.diffPixelRatio).toBeGreaterThan(0);
  });
});

describe("runVisualRegressionScan", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "dramaturge-visual-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a baseline on first capture and reports nothing", async () => {
    const baselineDir = join(tempDir, "baselines");
    const outputDir = join(tempDir, "run");

    const result = await runVisualRegressionScan(createMockPage(makeSolidPng([0, 100, 200, 255])), {
      areaName: "Dashboard",
      route: "https://example.com/dashboard",
      fingerprintHash: "dashboard-hash",
      baselineDir,
      outputDir,
      diffPixelRatioThreshold: 0.05,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    });

    expect(result.findings).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(existsSync(join(baselineDir, "dashboard-hash-4x4.png"))).toBe(true);
  });

  it("emits a visual finding and diff evidence when the page changes beyond threshold", async () => {
    const baselineDir = join(tempDir, "baselines");
    const outputDir = join(tempDir, "run");
    const baselinePage = createMockPage(makeSolidPng([0, 100, 200, 255]));
    const changedPage = createMockPage(makeSolidPng([220, 40, 10, 255]));

    await runVisualRegressionScan(baselinePage, {
      areaName: "Dashboard",
      route: "https://example.com/dashboard",
      fingerprintHash: "dashboard-hash",
      baselineDir,
      outputDir,
      diffPixelRatioThreshold: 0.05,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    });

    const result = await runVisualRegressionScan(changedPage, {
      areaName: "Dashboard",
      route: "https://example.com/dashboard",
      fingerprintHash: "dashboard-hash",
      baselineDir,
      outputDir,
      diffPixelRatioThreshold: 0.05,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      category: "Visual Glitch",
      severity: "Critical",
      title: "Visual regression detected",
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      type: "visual-diff",
    });
    expect(result.evidence[0].path).toContain("visual-diffs");
  });

  it("emits a finding when the current screenshot dimensions differ from the stored baseline", async () => {
    const baselineDir = join(tempDir, "baselines");
    const outputDir = join(tempDir, "run");

    await runVisualRegressionScan(createMockPage(makeSolidPng([0, 100, 200, 255], 4, 4)), {
      areaName: "Dashboard",
      route: "https://example.com/dashboard",
      fingerprintHash: "dashboard-hash",
      baselineDir,
      outputDir,
      diffPixelRatioThreshold: 0.05,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    });

    const result = await runVisualRegressionScan(
      createMockPage(makeSolidPng([0, 100, 200, 255], 6, 4)),
      {
        areaName: "Dashboard",
        route: "https://example.com/dashboard",
        fingerprintHash: "dashboard-hash",
        baselineDir,
        outputDir,
        diffPixelRatioThreshold: 0.05,
        includeAA: false,
        fullPage: true,
        maskSelectors: [],
      }
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      category: "Visual Glitch",
      severity: "Major",
      title: "Visual regression dimensions changed",
    });
    expect(result.findings[0].expected).toContain("4x4");
    expect(result.findings[0].actual).toContain("6x4");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].path).toContain("visual-diffs");
    expect(existsSync(join(baselineDir, "dashboard-hash-6x4.png"))).toBe(false);
  });
});
