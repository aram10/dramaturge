// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from "vitest";
import {
  collectWebVitals,
  evaluateWebVitals,
  type WebVitalsResult,
} from "./web-vitals.js";

describe("evaluateWebVitals", () => {
  it("returns no findings when all vitals are within thresholds", () => {
    const vitals: WebVitalsResult = { lcp: 1500, cls: 0.05, inp: 100 };
    const { findings, evidence } = evaluateWebVitals(vitals, "/", "test-area");

    expect(findings).toHaveLength(0);
    expect(evidence).toHaveLength(1); // metrics evidence still recorded
    expect(evidence[0].summary).toContain("LCP=1500ms");
    expect(evidence[0].summary).toContain("CLS=0.050");
    expect(evidence[0].summary).toContain("INP=100ms");
  });

  it("reports LCP finding when exceeding threshold", () => {
    const vitals: WebVitalsResult = { lcp: 3000, cls: 0.01, inp: 50 };
    const { findings } = evaluateWebVitals(vitals, "/slow-page", "test-area");

    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("Performance Issue");
    expect(findings[0].title).toContain("Largest Contentful Paint");
    expect(findings[0].actual).toContain("3000ms");
  });

  it("reports CLS finding when exceeding threshold", () => {
    const vitals: WebVitalsResult = { lcp: 1000, cls: 0.3, inp: 50 };
    const { findings } = evaluateWebVitals(vitals, "/", "test-area");

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("Cumulative Layout Shift");
    expect(findings[0].actual).toContain("0.300");
  });

  it("reports INP finding when exceeding threshold", () => {
    const vitals: WebVitalsResult = { lcp: 1000, cls: 0.01, inp: 350 };
    const { findings } = evaluateWebVitals(vitals, "/", "test-area");

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("Interaction to Next Paint");
    expect(findings[0].actual).toContain("350ms");
  });

  it("reports multiple findings when multiple vitals exceed thresholds", () => {
    const vitals: WebVitalsResult = { lcp: 5000, cls: 0.5, inp: 500 };
    const { findings } = evaluateWebVitals(vitals, "/bad-page", "test-area");

    expect(findings).toHaveLength(3);
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => t.includes("Largest Contentful Paint"))).toBe(true);
    expect(titles.some((t) => t.includes("Cumulative Layout Shift"))).toBe(true);
    expect(titles.some((t) => t.includes("Interaction to Next Paint"))).toBe(true);
  });

  it("skips null metrics without errors", () => {
    const vitals: WebVitalsResult = { lcp: null, cls: null, inp: null };
    const { findings, evidence } = evaluateWebVitals(vitals, "/", "test-area");

    expect(findings).toHaveLength(0);
    expect(evidence).toHaveLength(0);
  });

  it("uses custom thresholds when provided", () => {
    const vitals: WebVitalsResult = { lcp: 2000, cls: 0.05, inp: 100 };
    const { findings } = evaluateWebVitals(vitals, "/", "test-area", {
      lcpMs: 1000,
      cls: 0.01,
      inpMs: 50,
    });

    expect(findings).toHaveLength(3);
  });

  it("assigns correct severity for extreme LCP", () => {
    const vitals: WebVitalsResult = { lcp: 6000, cls: null, inp: null };
    const { findings } = evaluateWebVitals(vitals, "/", "test-area");

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Critical");
  });

  it("assigns Minor severity for borderline LCP", () => {
    const vitals: WebVitalsResult = { lcp: 2600, cls: null, inp: null };
    const { findings } = evaluateWebVitals(vitals, "/", "test-area");

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Minor");
  });

  it("includes evidence with all metric values in summary", () => {
    const vitals: WebVitalsResult = { lcp: 3000, cls: 0.2, inp: 250 };
    const { evidence } = evaluateWebVitals(vitals, "/test", "my-area");

    expect(evidence.length).toBeGreaterThanOrEqual(1);
    expect(evidence[0].summary).toContain("LCP=");
    expect(evidence[0].summary).toContain("CLS=");
    expect(evidence[0].summary).toContain("INP=");
  });
});
