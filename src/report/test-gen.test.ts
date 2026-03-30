import { describe, expect, it } from "vitest";
import { generatePlaywrightTests } from "./test-gen.js";
import type { RunResult } from "../types.js";

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    targetUrl: "https://example.com",
    startTime: new Date("2026-03-25T10:00:00Z"),
    endTime: new Date("2026-03-25T10:05:00Z"),
    areaResults: [],
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
    ...overrides,
  };
}

describe("generatePlaywrightTests", () => {
  it("builds a replayable Playwright spec from action traces", () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: "Knowledge bases",
            url: "https://example.com/manage/knowledge-bases",
            steps: 3,
            findings: [
              {
                ref: "fid-create-dialog",
                category: "Bug",
                severity: "Major",
                title: "Create dialog never opens",
                stepsToReproduce: ["Open knowledge bases", "Click Create"],
                expected: "The create dialog opens",
                actual: "Nothing happens",
                meta: {
                  source: "agent",
                  confidence: "medium",
                  repro: {
                    objective: "Validate create dialog flow",
                    route: "https://example.com/manage/knowledge-bases",
                    breadcrumbs: [
                      "navigate https://example.com/manage/knowledge-bases -> worked",
                      "click button[data-testid='create'] -> worked",
                    ],
                    actionIds: ["act-nav", "act-click"],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [
              {
                id: "act-nav",
                kind: "navigate",
                url: "https://example.com/manage/knowledge-bases",
                summary: "navigate https://example.com/manage/knowledge-bases -> worked",
                source: "page",
                status: "worked",
                timestamp: "2026-03-25T10:01:00Z",
              },
              {
                id: "act-click",
                kind: "click",
                selector: "button[data-testid='create']",
                summary: "click button[data-testid='create'] -> worked",
                source: "page",
                status: "worked",
                timestamp: "2026-03-25T10:01:01Z",
              },
            ],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
            pageType: "list",
            status: "explored",
          },
        ],
      })
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]?.filename).toBe("bug-001-create-dialog-never-opens.spec.ts");
    expect(generated[0]?.content).toContain("import { test, expect } from \"@playwright/test\";");
    expect(generated[0]?.content).toContain("await page.goto(\"https://example.com/manage/knowledge-bases\");");
    expect(generated[0]?.content).toContain("await page.locator(\"button[data-testid='create']\").click();");
    expect(generated[0]?.content).toContain('await expect(page.getByRole("dialog")).toBeVisible();');
    expect(generated[0]?.content).toContain("Expected: The create dialog opens");
    expect(generated[0]?.content).toContain("Actual: Nothing happens");
    expect(generated[0]?.content).not.toContain("expect(true).toBe(true)");
  });

  it("falls back to breadcrumb comments when no replayable actions are available", () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: "Settings",
            steps: 1,
            findings: [
              {
                ref: "fid-settings",
                category: "UX Concern",
                severity: "Minor",
                title: "Save feedback is unclear",
                stepsToReproduce: ["Open settings", "Click Save"],
                expected: "A success message confirms the save",
                actual: "The page changes without feedback",
                meta: {
                  source: "agent",
                  confidence: "low",
                  repro: {
                    objective: "Inspect save feedback",
                    route: "https://example.com/settings",
                    breadcrumbs: ["Open settings", "Click Save"],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
            pageType: "settings",
            status: "explored",
          },
        ],
      })
    );

    expect(generated[0]?.content).toContain("// Breadcrumbs:");
    expect(generated[0]?.content).toContain("// - Open settings");
    expect(generated[0]?.content).toContain("// - Click Save");
  });

  it("uses alert assertions for feedback-oriented findings", () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: "Settings",
            steps: 1,
            findings: [
              {
                ref: "fid-settings-feedback",
                category: "UX Concern",
                severity: "Minor",
                title: "Save feedback is unclear",
                stepsToReproduce: ["Open settings", "Click Save"],
                expected: "A success message confirms the save",
                actual: "The page changes without feedback",
                meta: {
                  source: "agent",
                  confidence: "medium",
                  repro: {
                    objective: "Inspect save feedback",
                    route: "https://example.com/settings",
                    breadcrumbs: ["Open settings", "Click Save"],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
            pageType: "settings",
            status: "explored",
          },
        ],
      })
    );

    expect(generated[0]?.content).toContain(
      'await expect(page.getByRole("alert")).toBeVisible();'
    );
  });
});
