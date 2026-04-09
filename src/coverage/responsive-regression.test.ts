// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi } from "vitest";
import {
  runMultiViewportVisualRegression,
  DEFAULT_BREAKPOINTS,
} from "./responsive-regression.js";

// Mock runVisualRegressionScan since it needs filesystem + real PNG operations
vi.mock("./visual-regression.js", () => ({
  runVisualRegressionScan: vi.fn().mockResolvedValue({
    findings: [],
    evidence: [],
  }),
}));

describe("DEFAULT_BREAKPOINTS", () => {
  it("provides mobile, tablet, and desktop breakpoints", () => {
    expect(DEFAULT_BREAKPOINTS).toHaveLength(3);
    expect(DEFAULT_BREAKPOINTS.map((bp) => bp.name)).toEqual([
      "mobile",
      "tablet",
      "desktop",
    ]);
  });

  it("has expected dimensions", () => {
    const mobile = DEFAULT_BREAKPOINTS.find((bp) => bp.name === "mobile");
    expect(mobile?.width).toBe(375);
    const tablet = DEFAULT_BREAKPOINTS.find((bp) => bp.name === "tablet");
    expect(tablet?.width).toBe(768);
    const desktop = DEFAULT_BREAKPOINTS.find((bp) => bp.name === "desktop");
    expect(desktop?.width).toBe(1440);
  });
});

describe("runMultiViewportVisualRegression", () => {
  it("calls setViewportSize for each breakpoint", async () => {
    const page = {
      setViewportSize: vi.fn(),
      viewportSize: () => ({ width: 1024, height: 768 }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      locator: vi.fn(),
    };

    const result = await runMultiViewportVisualRegression(page, {
      areaName: "test",
      route: "/test",
      fingerprintHash: "abc123",
      baselineDir: "/tmp/test-baselines",
      outputDir: "/tmp/test-output",
      diffPixelRatioThreshold: 0.01,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    });

    // Should attempt to set viewport for all 3 breakpoints + restore original
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 375, height: 812 });
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 768, height: 1024 });
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1440, height: 900 });
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1024, height: 768 });

    expect(result.findings).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it("works with custom breakpoints", async () => {
    const page = {
      setViewportSize: vi.fn(),
      viewportSize: () => ({ width: 1024, height: 768 }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      locator: vi.fn(),
    };

    const customBreakpoints = [{ name: "small", width: 320, height: 480 }];

    await runMultiViewportVisualRegression(page, {
      areaName: "test",
      route: "/",
      fingerprintHash: "xyz",
      baselineDir: "/tmp/test-baselines",
      outputDir: "/tmp/test-output",
      diffPixelRatioThreshold: 0.01,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
      breakpoints: customBreakpoints,
    });

    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 320, height: 480 });
  });
});
