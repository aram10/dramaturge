import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeFrontierItem } from "./execute-frontier-item.js";
import { executeWorkerTask } from "../worker/worker.js";
import { executeApiWorkerTask } from "../api/worker.js";
import { runAccessibilityScan } from "../coverage/accessibility.js";
import { runVisualRegressionScan } from "../coverage/visual-regression.js";
import { collectWebVitals, evaluateWebVitals } from "../coverage/web-vitals.js";
import { runMultiViewportVisualRegression } from "../coverage/responsive-regression.js";
import { analyzeScreenshot } from "../coverage/vision-analysis.js";
import { SafetyGuard } from "../policy/safety-guard.js";

vi.mock("../worker/worker.js", () => ({
  executeWorkerTask: vi.fn(),
}));

vi.mock("../api/worker.js", () => ({
  executeApiWorkerTask: vi.fn(),
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

vi.mock("../coverage/web-vitals.js", () => ({
  collectWebVitals: vi.fn().mockResolvedValue({
    lcp: null,
    cls: null,
    inp: null,
  }),
  evaluateWebVitals: vi.fn().mockReturnValue({
    findings: [],
    evidence: [],
  }),
}));

vi.mock("../coverage/responsive-regression.js", () => ({
  runMultiViewportVisualRegression: vi.fn().mockResolvedValue({
    findings: [],
    evidence: [],
  }),
}));

vi.mock("../coverage/vision-analysis.js", () => ({
  analyzeScreenshot: vi.fn().mockResolvedValue({
    findings: [],
    evidence: [],
    pageDescription: "",
  }),
}));

describe("executeFrontierItem", () => {
  beforeEach(() => {
    vi.mocked(executeWorkerTask).mockReset();
    vi.mocked(executeApiWorkerTask).mockReset();
    vi.mocked(runAccessibilityScan).mockReset();
    vi.mocked(runVisualRegressionScan).mockReset();
    vi.mocked(collectWebVitals).mockReset();
    vi.mocked(evaluateWebVitals).mockReset();
    vi.mocked(runMultiViewportVisualRegression).mockReset();
    vi.mocked(analyzeScreenshot).mockReset();
    vi.mocked(runAccessibilityScan).mockResolvedValue({
      findings: [],
      evidence: [],
    });
    vi.mocked(runVisualRegressionScan).mockResolvedValue({
      findings: [],
      evidence: [],
    });
    vi.mocked(collectWebVitals).mockResolvedValue({
      lcp: null,
      cls: null,
      inp: null,
    });
    vi.mocked(evaluateWebVitals).mockReturnValue({
      findings: [],
      evidence: [],
    });
    vi.mocked(runMultiViewportVisualRegression).mockResolvedValue({
      findings: [],
      evidence: [],
    });
    vi.mocked(analyzeScreenshot).mockResolvedValue({
      findings: [],
      evidence: [],
      pageDescription: "",
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
        webVitals: { enabled: false, thresholds: { lcpMs: 2500, cls: 0.1, inpMs: 200 } },
        responsiveRegression: { enabled: false },
        visionAnalysis: { enabled: false },
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
      undefined,
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
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(ctx.trafficObserver.resetPage).toHaveBeenCalledWith("page-1");
    expect(ctx.trafficObserver.snapshot).toHaveBeenCalledWith("page-1");
  });

  it("routes api tasks through the api worker without browser preflight scans", async () => {
    vi.mocked(executeApiWorkerTask).mockResolvedValue({
      taskId: "task-api",
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
      summary: "api ok",
    });

    const isolatedContext = {
      fetch: vi.fn(),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const ctx = {
      config: {
        targetUrl: "https://example.com",
        appDescription: "Example app",
        apiTesting: {
          enabled: true,
          maxEndpointsPerNode: 4,
          maxProbeCasesPerEndpoint: 6,
          unauthenticatedProbes: true,
          allowMutatingProbes: false,
        },
      },
      budget: {
        maxStepsPerTask: 5,
      },
      navigator: {
        navigateTo: vi.fn().mockResolvedValue({ success: true }),
      },
      planner: {
        recordDispatch: vi.fn(),
      },
      graph: {
        getNode: vi.fn().mockReturnValue({
          id: "node-api",
          title: "Widgets",
          pageType: "list",
          url: "https://example.com/widgets",
          fingerprint: {
            hash: "fp-widgets",
          },
        }),
        recordVisit: vi.fn(),
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
      contractIndex: {
        operations: [],
        operationsByKey: {},
      },
      createIsolatedApiRequestContext: vi.fn().mockResolvedValue(isolatedContext),
    } as any;

    const page = {
      request: {
        fetch: vi.fn(),
      },
      evaluate: vi.fn(),
      url: () => "https://example.com/widgets",
    } as any;

    const result = await executeFrontierItem({
      ctx,
      stagehand: { name: "worker-api" } as any,
      page,
      item: {
        id: "task-api",
        nodeId: "node-api",
        workerType: "api",
        objective: "Probe related APIs",
        priority: 0.8,
        reason: "coverage",
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending",
      },
      taskNumber: 3,
      pageKey: "page-api",
    });

    expect(result.result?.summary).toBe("api ok");
    expect(executeApiWorkerTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-api",
        areaName: "Widgets",
        pageRoute: "https://example.com/widgets",
        authenticatedRequestContext: page.request,
        config: ctx.config.apiTesting,
      })
    );
    expect(runAccessibilityScan).not.toHaveBeenCalled();
    expect(runVisualRegressionScan).not.toHaveBeenCalled();
    expect(executeWorkerTask).not.toHaveBeenCalled();
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
        webVitals: { enabled: false, thresholds: { lcpMs: 2500, cls: 0.1, inpMs: 200 } },
        responsiveRegression: { enabled: false },
        visionAnalysis: { enabled: false },
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

  it("runs web vitals and responsive regression scans when enabled", async () => {
    const order: string[] = [];
    vi.mocked(runAccessibilityScan).mockImplementation(async () => {
      order.push("accessibility");
      return { findings: [], evidence: [] };
    });
    vi.mocked(runVisualRegressionScan).mockImplementation(async () => {
      order.push("visual");
      return { findings: [], evidence: [] };
    });
    vi.mocked(collectWebVitals).mockImplementation(async () => {
      order.push("webvitals-collect");
      return { lcp: 1500, cls: 0.05, inp: 100 };
    });
    vi.mocked(evaluateWebVitals).mockImplementation(() => {
      order.push("webvitals-evaluate");
      return { findings: [], evidence: [] };
    });
    vi.mocked(runMultiViewportVisualRegression).mockImplementation(async () => {
      order.push("responsive");
      return { findings: [], evidence: [] };
    });
    vi.mocked(executeWorkerTask).mockImplementation(async () => {
      order.push("worker");
      return {
        taskId: "task-3",
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
        webVitals: {
          enabled: true,
          thresholds: { lcpMs: 2500, cls: 0.1, inpMs: 200 },
        },
        responsiveRegression: {
          enabled: true,
        },
        visionAnalysis: { enabled: false },
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
          id: "node-3",
          title: "Dashboard",
          pageType: "dashboard",
          url: "https://example.com/dashboard",
          fingerprint: {
            hash: "fp-dashboard",
          },
        }),
        recordVisit: vi.fn(),
      },
    } as any;

    await executeFrontierItem({
      ctx,
      stagehand: { name: "worker-3" } as any,
      page: {
        evaluate: vi.fn(),
        url: () => "https://example.com/dashboard",
      } as any,
      item: {
        id: "task-3",
        nodeId: "node-3",
        workerType: "navigation",
        objective: "Inspect the dashboard",
        priority: 0.7,
        reason: "coverage",
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending",
      },
      taskNumber: 3,
      pageKey: "page-3",
    });

    expect(order).toEqual([
      "accessibility",
      "visual",
      "webvitals-collect",
      "webvitals-evaluate",
      "responsive",
      "worker",
    ]);
    expect(collectWebVitals).toHaveBeenCalled();
    expect(evaluateWebVitals).toHaveBeenCalledWith(
      { lcp: 1500, cls: 0.05, inp: 100 },
      "https://example.com/dashboard",
      "Dashboard",
      { lcpMs: 2500, cls: 0.1, inpMs: 200 },
    );
    expect(runMultiViewportVisualRegression).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        areaName: "Dashboard",
        route: "https://example.com/dashboard",
        fingerprintHash: "fp-dashboard",
      }),
    );
  });

  it("runs vision analysis when enabled and merges findings into the result", async () => {
    const visionFinding = {
      ref: "fid-vision-1",
      category: "Visual Glitch" as const,
      severity: "Minor" as const,
      title: "Overlapping labels on chart",
      stepsToReproduce: ["Navigate to /dashboard"],
      expected: "Labels should not overlap",
      actual: "X-axis labels overlap at narrow widths",
      evidenceIds: ["ev-vision-1"],
    };
    const visionEvidence = {
      id: "ev-vision-1",
      type: "vision-analysis" as const,
      summary: "Vision analysis for Dashboard: 1 anomaly(ies) detected",
      timestamp: new Date().toISOString(),
      areaName: "Dashboard",
      relatedFindingIds: ["fid-vision-1"],
    };

    vi.mocked(analyzeScreenshot).mockResolvedValue({
      findings: [visionFinding],
      evidence: [visionEvidence],
      pageDescription: "A dashboard with sidebar and main content area.",
    });

    vi.mocked(executeWorkerTask).mockResolvedValue({
      taskId: "task-vision",
      findings: [
        {
          ref: "fid-worker-1",
          category: "Bug" as const,
          severity: "Major" as const,
          title: "Button does not respond",
          stepsToReproduce: ["Click the save button"],
          expected: "Data should save",
          actual: "Nothing happens",
        },
      ],
      evidence: [],
      coverageSnapshot: {
        controlsDiscovered: 3,
        controlsExercised: 2,
        events: [],
      },
      followupRequests: [],
      discoveredEdges: [],
      outcome: "completed",
      summary: "explored dashboard",
    });

    const ctx = {
      config: {
        targetUrl: "https://example.com",
        appDescription: "Dashboard app",
        models: {
          planner: "anthropic/claude-sonnet-4-6",
          worker: "anthropic/claude-haiku-4-5",
          agentMode: "cua",
        },
        budget: {
          stagnationThreshold: 3,
        },
        output: {
          screenshots: true,
        },
        visualRegression: {
          enabled: false,
        },
        webVitals: { enabled: false, thresholds: { lcpMs: 2500, cls: 0.1, inpMs: 200 } },
        responsiveRegression: { enabled: false },
        visionAnalysis: {
          enabled: true,
          model: "anthropic/claude-sonnet-4-20250514",
          fullPage: false,
          maxResponseTokens: 1024,
          requestTimeoutMs: 30_000,
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
          id: "node-dash",
          title: "Dashboard",
          pageType: "dashboard",
          url: "https://example.com/dashboard",
          fingerprint: { hash: "fp-dash" },
          controlsDiscovered: [],
          controlsExercised: [],
        }),
        recordVisit: vi.fn(),
      },
      trafficObserver: {
        resetPage: vi.fn(),
        snapshot: vi.fn().mockReturnValue([]),
      },
    } as any;

    const page = {
      evaluate: vi.fn(),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    } as any;

    const result = await executeFrontierItem({
      ctx,
      stagehand: {} as any,
      page,
      item: {
        id: "task-vision",
        nodeId: "node-dash",
        workerType: "navigation",
        objective: "Inspect the dashboard",
        priority: 0.8,
        reason: "coverage",
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending",
      } as const,
      taskNumber: 4,
      pageKey: "page-vision",
    });

    // 1. analyzeScreenshot is called with the configured options
    expect(analyzeScreenshot).toHaveBeenCalledWith(
      page,
      expect.objectContaining({
        areaName: "Dashboard",
        route: "https://example.com/dashboard",
        pageType: "dashboard",
        model: "anthropic/claude-sonnet-4-20250514",
        fullPage: false,
        maxResponseTokens: 1024,
        requestTimeoutMs: 30_000,
      }),
    );

    // 2. Vision findings/evidence are prepended into the final result
    expect(result.result).not.toBeNull();
    expect(result.result!.findings[0]).toEqual(visionFinding);
    expect(result.result!.findings).toHaveLength(2);
    expect(result.result!.evidence[0]).toEqual(visionEvidence);

    // 3. executeWorkerTask receives the visionContext argument
    expect(executeWorkerTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "A dashboard with sidebar and main content area.",
    );
  });

  it("skips execution when safety guard blocks the node URL", async () => {
    const guard = new SafetyGuard({
      allowedUrlPatterns: [],
      blockedUrlPatterns: ["/admin/**"],
      blockDestructiveRequests: true,
      destructiveActionKeywords: [],
    });

    const ctx = {
      config: {
        targetUrl: "https://example.com",
      },
      safetyGuard: guard,
      navigator: {
        navigateTo: vi.fn().mockResolvedValue({ success: true }),
      },
      graph: {
        getNode: vi.fn().mockReturnValue({
          id: "node-blocked",
          pageType: "list",
          url: "https://example.com/admin/delete",
        }),
      },
      planner: {
        recordDispatch: vi.fn(),
      },
      trafficObserver: {
        resetPage: vi.fn(),
        snapshot: vi.fn().mockReturnValue([]),
      },
    } as any;

    const result = await executeFrontierItem({
      ctx,
      stagehand: {} as any,
      page: {} as any,
      item: {
        id: "task-blocked",
        nodeId: "node-blocked",
        workerType: "navigation",
        objective: "Explore admin area",
        priority: 0.5,
        reason: "coverage",
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending",
      } as const,
      taskNumber: 1,
      pageKey: "page-blocked",
    });

    expect(result.result).toBeNull();
    expect(ctx.navigator.navigateTo).not.toHaveBeenCalled();
    expect(executeWorkerTask).not.toHaveBeenCalled();
  });
});
