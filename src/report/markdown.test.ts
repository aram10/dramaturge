import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.js";
import type { AreaResult, RunResult } from "../types.js";

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

describe("renderMarkdown", () => {
  it("includes blind spots section when present", () => {
    const md = renderMarkdown(
      makeResult({
        blindSpots: [
          { summary: "Unreachable settings modal", reason: "state-unreachable", severity: "high" },
          { summary: "Pruned low-priority task", reason: "pruned", severity: "low" },
        ],
      })
    );

    expect(md).toContain("## Blind Spots");
    expect(md).toContain("Unreachable settings modal");
    expect(md).toContain("state-unreachable");
    expect(md).toContain("Pruned low-priority task");
  });

  it("omits blind spots section when empty", () => {
    const md = renderMarkdown(makeResult());
    expect(md).not.toContain("## Blind Spots");
  });

  it("includes state graph Mermaid diagram when present", () => {
    const md = renderMarkdown(
      makeResult({
        stateGraphMermaid: "graph TD\n  A --> B",
      })
    );

    expect(md).toContain("## State Graph");
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph TD");
    expect(md).toContain("A --> B");
    expect(md).toContain("```");
  });

  it("omits state graph section when not provided", () => {
    const md = renderMarkdown(makeResult());
    expect(md).not.toContain("## State Graph");
  });

  it("includes run configuration when present", () => {
    const md = renderMarkdown(
      makeResult({
        runConfig: {
          appDescription: "My Test App",
          models: { planner: "claude-sonnet-4-6", worker: "claude-haiku-4-5" },
          concurrency: 3,
          budget: { timeLimitSeconds: 900, maxStepsPerTask: 40, maxStateNodes: 50 },
          checkpointInterval: 5,
          autoCaptureEnabled: true,
          llmPlannerEnabled: false,
        },
      })
    );

    expect(md).toContain("## Run Configuration");
    expect(md).toContain("My Test App");
    expect(md).toContain("claude-sonnet-4-6");
    expect(md).toContain("3 worker(s)");
    expect(md).toContain("Auto-capture:** enabled");
    expect(md).toContain("LLM planner:** disabled");
  });

  it("omits run configuration section when not provided", () => {
    const md = renderMarkdown(makeResult());
    expect(md).not.toContain("## Run Configuration");
  });

  it("renders confidence and repro details for findings", () => {
    const areaResult: AreaResult = {
      name: "Knowledge bases",
      url: "https://example.com/manage/knowledge-bases",
      steps: 2,
      findings: [
        {
          category: "Bug",
          severity: "Major",
          title: "Create button stops responding",
          stepsToReproduce: ["Open the page", "Click Create"],
          expected: "A dialog opens",
          actual: "Nothing happens",
          evidenceIds: ["ev-1"],
          meta: {
            source: "agent",
            confidence: "medium",
            repro: {
              stateId: "node-1",
              route: "https://example.com/manage/knowledge-bases",
              objective: "Validate knowledge base creation",
              breadcrumbs: [
                "click create button -> worked",
                "submit knowledge base form -> blocked",
              ],
              evidenceIds: ["ev-1"],
            },
          },
        },
      ],
      screenshots: new Map(),
      evidence: [],
      coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
      pageType: "list",
      status: "explored",
    };

    const md = renderMarkdown(
      makeResult({
        areaResults: [areaResult],
      })
    );

    expect(md).toContain("**Confidence:** medium");
    expect(md).toContain("**Source:** agent");
    expect(md).toContain("**Repro route:** https://example.com/manage/knowledge-bases");
    expect(md).toContain("click create button -> worked");
  });
});
