import { describe, expect, it, vi } from "vitest";
import { judgeWorkerObservations } from "./judge.js";

describe("judgeWorkerObservations", () => {
  it("turns observations into judged findings with trace-backed repro data", async () => {
    const evidence = [
      {
        id: "ev-1",
        type: "screenshot" as const,
        summary: "Create button state",
        timestamp: "2026-03-30T12:00:00Z",
        areaName: "Knowledge bases",
        relatedFindingIds: ["obs-1"],
      },
    ];

    const findings = await judgeWorkerObservations({
      observations: [
        {
          id: "obs-1",
          category: "Bug",
          severity: "Major",
          title: "Create button stops responding",
          stepsToReproduce: ["Open the page", "Click Create"],
          expected: "A dialog opens",
          actual: "Nothing happens",
          evidenceIds: ["ev-1"],
          route: "https://example.com/manage/knowledge-bases",
          objective: "Validate knowledge base creation",
          breadcrumbs: ["click create button -> worked"],
          actionIds: ["act-1"],
        },
      ],
      evidence,
      actions: [
        {
          id: "act-1",
          kind: "click",
          summary: "click create button -> worked",
          source: "worker-tool",
          status: "worked",
          timestamp: "2026-03-30T12:00:00Z",
        },
      ],
      config: {
        enabled: true,
        requestTimeoutMs: 10_000,
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verdict?.hypothesis).toContain("should");
    expect(findings[0]?.meta?.source).toBe("agent");
    expect(findings[0]?.meta?.repro?.actionIds).toEqual(["act-1"]);
    expect(findings[0]?.meta?.repro?.evidenceIds).toEqual(["ev-1"]);
    expect(evidence[0]?.relatedFindingIds[0]).toMatch(/^fid-/);
  });

  it("falls back to deterministic judgment when a custom judge throws", async () => {
    const findings = await judgeWorkerObservations({
      observations: [
        {
          id: "obs-2",
          category: "Bug",
          severity: "Major",
          title: "Save button never completes",
          stepsToReproduce: ["Open the page", "Click Save"],
          expected: "A success toast appears",
          actual: "The spinner never stops",
          evidenceIds: [],
          route: "https://example.com/settings",
          objective: "Validate settings save",
          breadcrumbs: [],
          actionIds: [],
        },
      ],
      evidence: [],
      actions: [],
      config: {
        enabled: true,
        requestTimeoutMs: 10_000,
      },
      judgeText: vi.fn().mockRejectedValue(new Error("judge timeout")),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verdict?.alternativesConsidered).toContain(
      "Judge fallback used because the preferred judgment path failed."
    );
  });
});
