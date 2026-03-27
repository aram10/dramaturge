import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeFrontierItem } from "./execute-frontier-item.js";
import { executeWorkerTask } from "../worker/worker.js";
import { runAccessibilityScan } from "../coverage/accessibility.js";
import { runVisualRegressionScan } from "../coverage/visual-regression.js";

vi.mock("../worker/worker.js", () => ({
  executeWorkerTask: vi.fn(),
}));

vi.mock("../coverage/accessibility.js", () => ({
  runAccessibilityScan: vi.fn().mockResolvedValue({
    findings: [],
    evidence: [],
  }),
}));

vi.mock("../coverage/visual-regression.js", () => ({
  runVisualRegressionScan: vi.fn().mockResolvedValue({
    findings: [],
    evidence: [],
  }),
}));

describe("executeFrontierItem", () => {
  beforeEach(() => {
    vi.mocked(executeWorkerTask).mockReset();
    vi.mocked(runAccessibilityScan).mockReset();
    vi.mocked(runVisualRegressionScan).mockReset();
    vi.mocked(runAccessibilityScan).mockResolvedValue({
      findings: [],
      evidence: [],
    });
    vi.mocked(runVisualRegressionScan).mockResolvedValue({
      findings: [],
      evidence: [],
    });
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
        routeFamilies: ["/", "/login", "/manage"],
        stableSelectors: ["#manage-kb-new-btn"],
        apiEndpoints: [
          {
            route: "/api/manage/knowledge-bases",
            methods: ["GET"],
            statuses: [401, 403],
          },
        ],
        authHints: {
          loginRoutes: ["/login"],
          callbackRoutes: ["/auth/callback"],
        },
        expectedHttpNoise: [],
      },
      trafficObserver: {
        resetPage: vi.fn(),
        snapshot: vi.fn().mockReturnValue([
          {
            route: "/api/widgets",
            methods: ["GET"],
            statuses: [200],
            failures: [],
          },
        ]),
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
        routeFamilies: ["/", "/login", "/manage"],
        stableSelectors: ["#manage-kb-new-btn"],
        apiEndpoints: [
          {
            route: "/api/manage/knowledge-bases",
            methods: ["GET"],
            statuses: [401, 403],
          },
        ],
        authHints: {
          loginRoutes: ["/login"],
          callbackRoutes: ["/auth/callback"],
        },
        expectedHttpNoise: [],
      },
      [
        {
          route: "/api/widgets",
          methods: ["GET"],
          statuses: [200],
          failures: [],
        },
      ],
      {
        appDescription: "Example app",
        destructiveActionsAllowed: false,
        criticalFlows: ["knowledge-bases"],
      },
      undefined
    );
    expect(ctx.trafficObserver.resetPage).toHaveBeenCalledWith("page-1");
    expect(ctx.trafficObserver.snapshot).toHaveBeenCalledWith("page-1");
  });

  it("runs deterministic scans against the navigated node state before worker exploration", async () => {
    const order: string[] = [];
    vi.mocked(runAccessibilityScan).mockImplementation(async () => {
      order.push("accessibility");
      return { findings: [], evidence: [] };
    });
    vi.mocked(runVisualRegressionScan).mockImplementation(async () => {
      order.push("visual");
      return { findings: [], evidence: [] };
    });
    vi.mocked(executeWorkerTask).mockImplementation(async () => {
      order.push("worker");
      return {
        taskId: "task-2",
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
      };
    });

    const ctx = {
      config: {
        targetUrl: "https://example.com",
        appDescription: "Example app",
        models: {
          planner: "anthropic/claude-sonnet-4-6",
          worker: "anthropic/claude-haiku-4-5",
          agentMode: "dom",
        },
        budget: {
          stagnationThreshold: 3,
        },
        output: {
          screenshots: true,
        },
        visualRegression: {
          enabled: true,
          baselineDir: "C:/tmp/baselines",
          diffPixelRatioThreshold: 0.01,
          includeAA: false,
          fullPage: true,
          maskSelectors: [],
        },
      },
      budget: {
        maxStepsPerTask: 5,
      },
      screenshotDir: "C:/tmp/screenshots",
      outputDir: "C:/tmp/output",
      navigator: {
        navigateTo: vi.fn().mockResolvedValue({ success: true }),
      },
      planner: {
        recordDispatch: vi.fn(),
      },
      graph: {
        getNode: vi.fn().mockReturnValue({
          id: "node-2",
          title: "Items",
          pageType: "list",
          url: "https://example.com/items",
          fingerprint: {
            hash: "fp-items",
          },
        }),
        recordVisit: vi.fn(),
      },
    } as any;

    await executeFrontierItem({
      ctx,
      stagehand: { name: "worker-2" } as any,
      page: {
        evaluate: vi.fn(),
        url: () => "https://example.com/items",
      } as any,
      item: {
        id: "task-2",
        nodeId: "node-2",
        workerType: "navigation",
        objective: "Inspect the items page",
        priority: 0.7,
        reason: "coverage",
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending",
      },
      taskNumber: 2,
      pageKey: "page-2",
    });

    expect(order).toEqual(["accessibility", "visual", "worker"]);
  });
});
