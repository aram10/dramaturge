import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeFrontierItem } from "./execute-frontier-item.js";
import { executeWorkerTask } from "../worker/worker.js";

vi.mock("../worker/worker.js", () => ({
  executeWorkerTask: vi.fn(),
}));

describe("executeFrontierItem", () => {
  beforeEach(() => {
    vi.mocked(executeWorkerTask).mockReset();
  });

  it("passes the full worker option set through to executeWorkerTask", async () => {
    vi.mocked(executeWorkerTask).mockResolvedValue({
      taskId: "task-1",
      findings: [],
      evidence: [],
      coverageSnapshot: {
        controlsDiscovered: 0,
        controlsExercised: 0,
        events: [],
      },
      followupRequests: [],
      discoveredEdges: [],
      outcome: "completed",
      summary: "ok",
    });

    const stagehand = { name: "worker-1" } as any;
    const page = { name: "page-1" } as any;
    const item = {
      id: "task-1",
      nodeId: "node-1",
      workerType: "crud",
      objective: "Inspect the list page",
      priority: 0.8,
      reason: "coverage",
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: "pending",
    } as const;

    const ctx = {
      config: {
        targetUrl: "https://example.com",
        appDescription: "Example app",
        models: {
          planner: "anthropic/claude-sonnet-4-6",
          worker: "anthropic/claude-haiku-4-5",
          workers: {
            crud: "openai/gpt-4.1-mini",
          },
          agentMode: "cua",
          agentModes: {
            crud: "dom",
          },
        },
        budget: {
          stagnationThreshold: 7,
        },
        output: {
          screenshots: false,
        },
        appContext: {
          knownPatterns: ["401s are expected before login"],
        },
      },
      budget: {
        maxStepsPerTask: 12,
      },
      screenshotDir: "C:/tmp/screenshots",
      repoHints: {
        routes: ["/login", "/manage/knowledge-bases"],
        stableSelectors: ["#manage-kb-new-btn"],
        authHints: {
          loginRoutes: ["/login"],
          callbackRoutes: ["/auth/callback"],
        },
        expectedHttpNoise: [],
      },
      mission: {
        appDescription: "Example app",
        destructiveActionsAllowed: false,
        criticalFlows: ["knowledge-bases"],
      },
      navigator: {
        navigateTo: vi.fn().mockResolvedValue({ success: true }),
      },
      planner: {
        recordDispatch: vi.fn(),
      },
      graph: {
        getNode: vi.fn().mockReturnValue({
          id: "node-1",
          pageType: "list",
          url: "https://example.com/items",
        }),
        recordVisit: vi.fn(),
      },
    } as any;

    const result = await executeFrontierItem({
      ctx,
      stagehand,
      page,
      item,
      taskNumber: 1,
      pageKey: "page-1",
    });

    expect(result).toMatchObject({
      item,
      result: {
        taskId: "task-1",
        outcome: "completed",
      },
    });

    expect(executeWorkerTask).toHaveBeenCalledWith(
      stagehand,
      {
        id: "task-1",
        workerType: "crud",
        nodeId: "node-1",
        objective: "Inspect the list page",
        maxSteps: 12,
        pageType: "list",
        missionContext: "Example app",
      },
      "openai/gpt-4.1-mini",
      "C:/tmp/screenshots",
      "dom",
      false,
      7,
      {
        knownPatterns: ["401s are expected before login"],
      },
      {
        routes: ["/login", "/manage/knowledge-bases"],
        stableSelectors: ["#manage-kb-new-btn"],
        authHints: {
          loginRoutes: ["/login"],
          callbackRoutes: ["/auth/callback"],
        },
        expectedHttpNoise: [],
      },
      {
        appDescription: "Example app",
        destructiveActionsAllowed: false,
        criticalFlows: ["knowledge-bases"],
      },
      undefined
    );
  });
});
