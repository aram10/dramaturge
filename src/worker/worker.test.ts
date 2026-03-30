import { describe, expect, it, vi } from "vitest";
import { executeWorkerTask } from "./worker.js";

function createMockPage() {
  return {
    url: () => "https://example.com/manage/knowledge-bases",
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
  };
}

describe("executeWorkerTask", () => {
  it("hands explorer observations off to the judge before returning findings", async () => {
    const page = createMockPage();

    const stagehand = {
      context: {
        pages: () => [page],
      },
      agent: vi.fn(({ tools }) => ({
        execute: async () => {
          await tools.log_finding.execute({
            category: "Bug",
            severity: "Major",
            title: "Create button stops responding",
            stepsToReproduce: ["Open the page", "Click Create"],
            expected: "A dialog opens",
            actual: "Nothing happens",
          });

          return { actions: [] };
        },
      })),
    } as any;

    const result = await executeWorkerTask(
      stagehand,
      {
        id: "task-judge-1",
        workerType: "navigation",
        nodeId: "node-1",
        objective: "Inspect the knowledge bases page",
        maxSteps: 5,
        pageType: "list",
        missionContext: "Example app",
      },
      "anthropic/claude-haiku-4-5",
      "C:/tmp/screenshots",
      "dom",
      false,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        appDescription: "Example app",
        destructiveActionsAllowed: false,
      },
      undefined,
      undefined,
      {
        enabled: true,
        requestTimeoutMs: 10_000,
      }
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.verdict?.hypothesis).toContain("should");
    expect(result.findings[0]?.meta?.source).toBe("agent");
  });
});
