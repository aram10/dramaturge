import { describe, expect, it } from "vitest";
import { renderJson } from "./json.js";
import type { AreaResult, RunResult } from "../types.js";

function makeResult(areaResults: AreaResult[]): RunResult {
  return {
    targetUrl: "https://example.com",
    startTime: new Date("2026-03-25T10:00:00Z"),
    endTime: new Date("2026-03-25T10:05:00Z"),
    areaResults,
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
  };
}

describe("renderJson", () => {
  it("maps evidence links to final finding ids and preserves grouped occurrences", () => {
    const result = makeResult([
      {
        name: "Knowledge bases",
        steps: 1,
        findings: [
          {
            ref: "fid-kb",
            category: "Bug",
            severity: "Major",
            title: "Create button stops responding",
            stepsToReproduce: ["Open the page", "Click Create"],
            expected: "A dialog opens",
            actual: "Nothing happens",
            evidenceIds: ["ev-1"],
            verdict: {
              hypothesis: "Clicking Create should open a dialog.",
              observation: "Nothing happened after the click.",
              evidenceChain: ["ev-1", "act-1"],
              alternativesConsidered: ["A slow render; no dialog appeared after waiting."],
              suggestedVerification: ["Retry the click on a fresh page load."],
            },
            meta: {
              source: "agent",
              confidence: "medium",
              repro: {
                objective: "Validate knowledge base creation",
                breadcrumbs: ["click create button -> worked"],
                actionIds: ["act-1"],
                evidenceIds: ["ev-1"],
                route: "https://example.com/manage/knowledge-bases",
              },
            },
          },
        ],
        screenshots: new Map(),
        evidence: [
          {
            id: "ev-1",
            type: "screenshot",
            summary: "Create button before click",
            path: "screenshots/ss-kb.png",
            timestamp: "2026-03-25T10:01:00Z",
            areaName: "Knowledge bases",
            relatedFindingIds: ["fid-kb"],
          },
        ],
        replayableActions: [
          {
            id: "act-1",
            kind: "click",
            selector: "button[data-testid='create']",
            summary: "click create button -> worked",
            source: "worker-tool",
            status: "worked",
            timestamp: "2026-03-25T10:01:00Z",
          },
        ],
        coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
        pageType: "list",
        status: "explored",
      },
      {
        name: "Settings",
        steps: 1,
        findings: [
          {
            ref: "fid-settings",
            category: "Bug",
            severity: "Major",
            title: "Create button stops responding",
            stepsToReproduce: ["Open the page", "Click Create"],
            expected: "A dialog opens",
            actual: "Nothing happens",
            evidenceIds: ["ev-2"],
            verdict: {
              hypothesis: "Clicking Create should open a dialog.",
              observation: "Nothing happened after the click.",
              evidenceChain: ["ev-2", "act-2"],
              alternativesConsidered: ["A slow render; no dialog appeared after waiting."],
              suggestedVerification: ["Retry the click on a fresh page load."],
            },
            meta: {
              source: "agent",
              confidence: "medium",
              repro: {
                objective: "Validate settings creation flow",
                breadcrumbs: ["click create button -> worked"],
                actionIds: ["act-2"],
                evidenceIds: ["ev-2"],
                route: "https://example.com/settings",
              },
            },
          },
        ],
        screenshots: new Map(),
        evidence: [
          {
            id: "ev-2",
            type: "screenshot",
            summary: "Create button in settings",
            path: "screenshots/ss-settings.png",
            timestamp: "2026-03-25T10:02:00Z",
            areaName: "Settings",
            relatedFindingIds: ["fid-settings"],
          },
        ],
        replayableActions: [
          {
            id: "act-2",
            kind: "click",
            selector: "button[data-testid='create']",
            summary: "click create button -> worked",
            source: "worker-tool",
            status: "worked",
            timestamp: "2026-03-25T10:02:00Z",
          },
        ],
        coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
        pageType: "settings",
        status: "explored",
      },
    ]);

    const report = JSON.parse(renderJson(result));

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      id: "BUG-001",
      occurrenceCount: 2,
      impactedAreas: ["Knowledge bases", "Settings"],
      verdict: {
        hypothesis: "Clicking Create should open a dialog.",
        observation: "Nothing happened after the click.",
      },
    });
    expect(report.findings[0].occurrences).toHaveLength(2);
    expect(report.evidence[0].relatedFindingIds).toEqual(["BUG-001"]);
    expect(report.evidence[1].relatedFindingIds).toEqual(["BUG-001"]);
    expect(report.actions).toEqual([
      expect.objectContaining({
        id: "act-1",
        areaName: "Knowledge bases",
        kind: "click",
      }),
      expect.objectContaining({
        id: "act-2",
        areaName: "Settings",
        kind: "click",
      }),
    ]);
  });
});
