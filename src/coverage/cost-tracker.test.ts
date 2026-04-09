// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from "vitest";
import {
  CostTracker,
  estimateCallCost,
  approximateTokenCount,
} from "./cost-tracker.js";

describe("estimateCallCost", () => {
  it("calculates cost for known models", () => {
    const cost = estimateCallCost("anthropic/claude-haiku-4-5", 1_000_000, 1_000_000);
    // Haiku: $0.80/M input + $4.00/M output = $4.80
    expect(cost).toBeCloseTo(4.80, 1);
  });

  it("calculates cost for sonnet model", () => {
    const cost = estimateCallCost("anthropic/claude-sonnet-4-6", 100_000, 50_000);
    // Sonnet: $3.00/M * 0.1 + $15.00/M * 0.05 = 0.30 + 0.75 = $1.05
    expect(cost).toBeCloseTo(1.05, 2);
  });

  it("uses fallback pricing for unknown models", () => {
    const cost = estimateCallCost("some-unknown-model", 100_000, 50_000);
    expect(cost).toBeGreaterThan(0);
  });

  it("handles prefix-stripped provider notation", () => {
    const withPrefix = estimateCallCost("anthropic/claude-haiku-4-5", 1000, 500);
    const withoutPrefix = estimateCallCost("claude-haiku-4-5", 1000, 500);
    expect(withPrefix).toBe(withoutPrefix);
  });
});

describe("approximateTokenCount", () => {
  it("estimates tokens from character count", () => {
    const tokens = approximateTokenCount("Hello, world!"); // 13 chars -> ~4 tokens
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(5);
  });

  it("handles empty string", () => {
    expect(approximateTokenCount("")).toBe(0);
  });

  it("returns reasonable estimates for longer text", () => {
    const text = "a".repeat(1000);
    const tokens = approximateTokenCount(text);
    expect(tokens).toBe(250); // 1000 / 4
  });
});

describe("CostTracker", () => {
  it("starts with zero cost", () => {
    const tracker = new CostTracker();
    expect(tracker.totalCostUsd).toBe(0);
    expect(tracker.overBudget).toBe(false);
  });

  it("accumulates cost from multiple records", () => {
    const tracker = new CostTracker();
    tracker.record("claude-haiku-4-5", 10000, 5000, "planner-call");
    tracker.record("claude-haiku-4-5", 10000, 5000, "worker-call");

    expect(tracker.totalCostUsd).toBeGreaterThan(0);
    expect(tracker.getRecords()).toHaveLength(2);
  });

  it("reports over budget when limit is exceeded", () => {
    const tracker = new CostTracker(0.001); // very small budget
    tracker.record("claude-sonnet-4-6", 100000, 50000, "expensive-call");

    expect(tracker.overBudget).toBe(true);
  });

  it("stays within budget for small calls with high limit", () => {
    const tracker = new CostTracker(100); // generous budget
    tracker.record("claude-haiku-4-5", 100, 50, "cheap-call");

    expect(tracker.overBudget).toBe(false);
  });

  it("provides accurate summary", () => {
    const tracker = new CostTracker(50);
    tracker.record("claude-haiku-4-5", 1000, 500, "call-1");
    tracker.record("claude-sonnet-4-6", 2000, 1000, "call-2");
    tracker.record("claude-haiku-4-5", 1500, 750, "call-3");

    const summary = tracker.getSummary();
    expect(summary.callCount).toBe(3);
    expect(summary.totalInputTokens).toBe(4500);
    expect(summary.totalOutputTokens).toBe(2250);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(Object.keys(summary.byModel)).toHaveLength(2);
    expect(summary.byModel["claude-haiku-4-5"].calls).toBe(2);
    expect(summary.byModel["claude-sonnet-4-6"].calls).toBe(1);
    expect(summary.overBudget).toBe(false);
  });

  it("unlimited budget when costLimitUsd is Infinity", () => {
    const tracker = new CostTracker(Infinity);
    tracker.record("claude-opus-4-5", 1_000_000, 1_000_000, "huge-call");
    expect(tracker.overBudget).toBe(false);
  });

  it("record returns the cost entry with correct fields", () => {
    const tracker = new CostTracker();
    const record = tracker.record("anthropic/claude-haiku-4-5", 5000, 2000, "test-label");

    expect(record.model).toBe("claude-haiku-4-5");
    expect(record.inputTokens).toBe(5000);
    expect(record.outputTokens).toBe(2000);
    expect(record.costUsd).toBeGreaterThan(0);
    expect(record.label).toBe("test-label");
    expect(record.timestamp).toBeTruthy();
  });
});
