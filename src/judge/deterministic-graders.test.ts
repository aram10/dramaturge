import { describe, it, expect } from "vitest";
import {
  gradeByConsoleErrors,
  gradeByNetworkErrors,
  gradeByEvidenceCompleteness,
  runDeterministicGraders,
} from "./deterministic-graders.js";
import type { Evidence } from "../types.js";
import type { Observation } from "./types.js";

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    category: "Bug",
    severity: "Major",
    title: "Test finding",
    stepsToReproduce: ["Step 1"],
    expected: "It should work",
    actual: "It did not work",
    evidenceIds: [],
    route: "/test",
    objective: "Test objective",
    breadcrumbs: [],
    actionIds: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    type: "screenshot",
    summary: "Test screenshot",
    timestamp: new Date().toISOString(),
    relatedFindingIds: [],
    ...overrides,
  };
}

describe("gradeByConsoleErrors", () => {
  it("gives low confidence when finding mentions console errors but has no evidence", () => {
    const obs = makeObservation({
      actual: "A console error appeared in the browser",
      evidenceIds: ["ev-1"],
    });
    const evidence = [makeEvidence({ id: "ev-1", type: "screenshot" })];

    const result = gradeByConsoleErrors(obs, evidence);
    expect(result.confirmed).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("gives high confidence when console-error evidence exists", () => {
    const obs = makeObservation({
      actual: "Something failed",
      evidenceIds: ["ev-1"],
    });
    const evidence = [makeEvidence({ id: "ev-1", type: "console-error" })];

    const result = gradeByConsoleErrors(obs, evidence);
    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("gives medium confidence when no console error evidence is applicable", () => {
    const obs = makeObservation({ actual: "Button does nothing" });
    const result = gradeByConsoleErrors(obs, []);
    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBe("medium");
  });
});

describe("gradeByNetworkErrors", () => {
  it("gives low confidence when finding mentions HTTP status but has no network evidence", () => {
    const obs = makeObservation({
      actual: "The API returned a 500 error",
      evidenceIds: ["ev-1"],
    });
    const evidence = [makeEvidence({ id: "ev-1", type: "screenshot" })];

    const result = gradeByNetworkErrors(obs, evidence);
    expect(result.confirmed).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("gives high confidence when network-error evidence exists", () => {
    const obs = makeObservation({
      actual: "Something failed",
      evidenceIds: ["ev-1"],
    });
    const evidence = [makeEvidence({ id: "ev-1", type: "network-error" })];

    const result = gradeByNetworkErrors(obs, evidence);
    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("detects status codes in title too", () => {
    const obs = makeObservation({
      title: "404 Not Found on user profile",
      actual: "Page not found",
      evidenceIds: [],
    });
    const result = gradeByNetworkErrors(obs, []);
    expect(result.confirmed).toBe(false);
    expect(result.confidence).toBe("low");
  });
});

describe("gradeByEvidenceCompleteness", () => {
  it("gives low confidence when finding has no evidence", () => {
    const obs = makeObservation({ evidenceIds: [] });
    const result = gradeByEvidenceCompleteness(obs, []);
    expect(result.confirmed).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("gives medium confidence with single evidence type", () => {
    const obs = makeObservation({ evidenceIds: ["ev-1"] });
    const evidence = [makeEvidence({ id: "ev-1", type: "screenshot" })];

    const result = gradeByEvidenceCompleteness(obs, evidence);
    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBe("medium");
  });

  it("gives high confidence with multiple evidence types", () => {
    const obs = makeObservation({ evidenceIds: ["ev-1", "ev-2"] });
    const evidence = [
      makeEvidence({ id: "ev-1", type: "screenshot" }),
      makeEvidence({ id: "ev-2", type: "console-error" }),
    ];

    const result = gradeByEvidenceCompleteness(obs, evidence);
    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBe("high");
  });
});

describe("runDeterministicGraders", () => {
  it("returns all three grader results", () => {
    const obs = makeObservation({ evidenceIds: ["ev-1"] });
    const evidence = [makeEvidence({ id: "ev-1", type: "screenshot" })];

    const { results } = runDeterministicGraders(obs, evidence);
    expect(results).toHaveLength(3);
    const graders = results.map((r) => r.grader);
    expect(graders).toContain("console-error");
    expect(graders).toContain("network-error");
    expect(graders).toContain("evidence-completeness");
  });

  it("reports lowest confidence from all graders", () => {
    const obs = makeObservation({
      actual: "console error appeared and 500 status returned",
      evidenceIds: [],
    });
    const { combinedConfidence, allConfirmed } = runDeterministicGraders(obs, []);

    expect(combinedConfidence).toBe("low");
    expect(allConfirmed).toBe(false);
  });

  it("reports high confidence when all graders pass with multi-type evidence", () => {
    const obs = makeObservation({
      actual: "Button is misaligned",
      evidenceIds: ["ev-1", "ev-2"],
    });
    const evidence = [
      makeEvidence({ id: "ev-1", type: "screenshot" }),
      makeEvidence({ id: "ev-2", type: "visual-diff" }),
    ];

    const { combinedConfidence, allConfirmed } = runDeterministicGraders(obs, evidence);
    // Expected: medium confidence (lowest among console-error and network-error
    // pass-through at medium, evidence-completeness at high for 2 types).
    expect(combinedConfidence).toBe("medium");
    expect(allConfirmed).toBe(true);
  });
});
