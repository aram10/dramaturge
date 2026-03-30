import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../llm.js", () => ({
  hasLLMApiKey: vi.fn(),
  judgeObservationWithLLM: vi.fn(),
}));

import { executeWorkerTask } from "./worker.js";
import { hasLLMApiKey, judgeObservationWithLLM } from "../llm.js";

function createMockPage() {
  return {
    url: () => "https://example.com/manage/knowledge-bases",
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
  };
}

describe("executeWorkerTask", () => {
  beforeEach(() => {
    vi.mocked(hasLLMApiKey).mockReset();
    vi.mocked(judgeObservationWithLLM).mockReset();
  });

  it("uses the configured judge model path when an LLM judge is available", async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(true);
    vi.mocked(judgeObservationWithLLM).mockResolvedValue({
      hypothesis: "The create flow should open a dialog.",
      observation: "The dialog did not appear after clicking Create.",
      alternativesConsidered: ["The click target may have been obscured."],
      suggestedVerification: ["Retry after a hard refresh."],
      confidence: "high",
    });

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
        id: "task-judge-llm",
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

    expect(judgeObservationWithLLM).toHaveBeenCalledTimes(1);
    expect(result.findings[0]?.verdict?.hypothesis).toBe("The create flow should open a dialog.");
    expect(result.findings[0]?.meta?.confidence).toBe("high");
  });

  it("hands explorer observations off to the judge before returning findings", async () => {
    vi.mocked(hasLLMApiKey).mockReturnValue(false);
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
