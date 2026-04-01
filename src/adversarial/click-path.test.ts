import { describe, it, expect } from "vitest";
import { listClickPathScenarios } from "./click-path.js";

describe("listClickPathScenarios", () => {
  it("returns all non-mutation scenarios when destructive actions are disabled", () => {
    const scenarios = listClickPathScenarios({ destructiveActionsAllowed: false });
    const ids = scenarios.map((s) => s.id);

    expect(ids).toContain("sequential-undo");
    expect(ids).toContain("async-race-condition");
    expect(ids).toContain("stale-closure-handler");
    expect(ids).toContain("conditional-dead-path");
    expect(ids).toContain("effect-interference");
    // mutation-requiring scenario should be excluded
    expect(ids).not.toContain("missing-state-transition");
  });

  it("includes mutation scenarios when destructive actions are allowed", () => {
    const scenarios = listClickPathScenarios({ destructiveActionsAllowed: true });
    const ids = scenarios.map((s) => s.id);

    expect(ids).toContain("missing-state-transition");
    expect(ids).toContain("sequential-undo");
    expect(scenarios.length).toBe(6);
  });

  it("every scenario has required fields", () => {
    const scenarios = listClickPathScenarios({ destructiveActionsAllowed: true });
    for (const scenario of scenarios) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.title).toBeTruthy();
      expect(scenario.description).toBeTruthy();
      expect(scenario.description.length).toBeGreaterThan(20);
    }
  });
});
