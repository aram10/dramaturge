import { describe, expect, it, vi } from "vitest";
import { StateGraph } from "../graph/state-graph.js";
import {
  assignPageNodeOwner,
  expandGraph,
  flushOwnedBrowserErrors,
} from "./graph-ops.js";

vi.mock("../graph/fingerprint.js", () => ({
  captureFingerprint: vi.fn().mockResolvedValue({
    normalizedPath: "/items/42",
    signature: {
      pathname: "/items/42",
      query: [],
      uiMarkers: [],
    },
    title: "Item 42",
    heading: "Item 42",
    dialogTitles: [],
    hash: "fp-item-42",
  }),
}));

vi.mock("../planner/page-classifier.js", () => ({
  classifyPage: vi.fn().mockResolvedValue("detail"),
}));

describe("expandGraph", () => {
  it("persists the resolved page URL when discovered edges do not report one", async () => {
    const graph = new StateGraph();
    const sourceNode = graph.addNode({
      url: "https://example.com/items",
      title: "Items",
      fingerprint: {
        normalizedPath: "/items",
        signature: {
          pathname: "/items",
          query: [],
          uiMarkers: [],
        },
        title: "Items",
        heading: "Items",
        dialogTitles: [],
        hash: "fp-items",
      },
      pageType: "list",
      depth: 0,
    });

    const frontier = {
      enqueueMany: vi.fn(),
    };

    const ctx = {
      graph,
      budget: { maxStateNodes: 10 },
      navigator: {
        navigateFromNode: vi.fn().mockResolvedValue({ success: true }),
      },
      page: {
        url: () => "https://example.com/items/42?tab=details",
        goto: vi.fn().mockResolvedValue(undefined),
      },
      stagehand: { context: { pages: () => [] } },
      config: {
        targetUrl: "https://example.com/items",
      },
      planner: {
        proposeTasks: vi.fn().mockReturnValue([]),
      },
      frontier,
      mission: undefined,
      repoHints: undefined,
      memoryStore: undefined,
    } as any;

    await expandGraph(
      ctx,
      sourceNode.id,
      {
        taskId: "task-1",
        findings: [],
        evidence: [],
        coverageSnapshot: {
          controlsDiscovered: 0,
          controlsExercised: 0,
          events: [],
        },
        followupRequests: [],
        discoveredEdges: [
          {
            actionLabel: "Open item 42",
            navigationHint: {
              selector: "a[href='/items/42']",
              actionDescription: "Open item 42",
            },
            targetFingerprint: {
              normalizedPath: "",
              signature: {
                pathname: "",
                query: [],
                uiMarkers: [],
              },
              title: "",
              heading: "",
              dialogTitles: [],
              hash: "",
            },
            targetPageType: "unknown",
          },
        ],
        outcome: "completed",
        summary: "ok",
      },
      false
    );

    const discoveredNode = graph.getAllNodes().find((node) => node.id !== sourceNode.id);
    expect(discoveredNode?.url).toBe("https://example.com/items/42?tab=details");
  });
});

describe("browser error ownership", () => {
  it("flushes pending page errors to the previous owner before reassigning the page", () => {
    const ctx = {
      pageNodeOwners: new Map([["primary", "node-root"]]),
      errorCollector: {
        pendingCount: vi.fn().mockImplementation((pageKey: string) =>
          pageKey === "primary" ? 1 : 0
        ),
        flush: vi.fn().mockReturnValue({
          findings: [
            {
              ref: "fid-1",
              category: "Bug",
              severity: "Major",
              title: "Console error",
              stepsToReproduce: ["Open the page"],
              expected: "No console errors",
              actual: "Boom",
              evidenceIds: ["ev-1"],
            },
          ],
          evidence: [
            {
              id: "ev-1",
              type: "console-error",
              summary: "Boom",
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      },
      findingsByNode: new Map(),
      evidenceByNode: new Map(),
    } as any;

    assignPageNodeOwner(ctx, "primary", "node-task");

    expect(ctx.pageNodeOwners.get("primary")).toBe("node-task");
    expect(ctx.errorCollector.flush).toHaveBeenCalledWith("primary");
    expect(ctx.findingsByNode.get("node-root")).toHaveLength(1);
    expect(ctx.evidenceByNode.get("node-root")).toHaveLength(1);
  });

  it("flushes remaining page errors to the tracked owner", () => {
    const ctx = {
      pageNodeOwners: new Map([["worker-1", "node-detail"]]),
      errorCollector: {
        pendingCount: vi.fn().mockImplementation((pageKey: string) =>
          pageKey === "worker-1" ? 1 : 0
        ),
        flush: vi.fn().mockReturnValue({
          findings: [
            {
              ref: "fid-2",
              category: "Bug",
              severity: "Minor",
              title: "Network error",
              stepsToReproduce: ["Open the page"],
              expected: "A successful response",
              actual: "500",
              evidenceIds: ["ev-2"],
            },
          ],
          evidence: [
            {
              id: "ev-2",
              type: "network-error",
              summary: "500",
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      },
      findingsByNode: new Map(),
      evidenceByNode: new Map(),
    } as any;

    flushOwnedBrowserErrors(ctx, "worker-1");

    expect(ctx.errorCollector.flush).toHaveBeenCalledWith("worker-1");
    expect(ctx.findingsByNode.get("node-detail")).toHaveLength(1);
    expect(ctx.evidenceByNode.get("node-detail")).toHaveLength(1);
  });
});

describe("expandGraph restrictToChanged", () => {
  function makeSourceGraph() {
    const graph = new StateGraph();
    const source = graph.addNode({
      url: "https://example.com",
      title: "Home",
      fingerprint: {
        normalizedPath: "/",
        signature: { pathname: "/", query: [], uiMarkers: [] },
        title: "Home",
        heading: "Home",
        dialogTitles: [],
        hash: "fp-home",
      },
      pageType: "landing",
      depth: 0,
    });
    return { graph, source };
  }

  function makeEdge(url: string, hash: string) {
    return {
      actionLabel: `Go to ${url}`,
      navigationHint: { url, actionDescription: `Go to ${url}` },
      targetFingerprint: {
        normalizedPath: new URL(url).pathname,
        signature: { pathname: new URL(url).pathname, query: [], uiMarkers: [] },
        title: url,
        heading: url,
        dialogTitles: [],
        hash,
      },
      targetPageType: "detail" as const,
    };
  }

  function makeCtx(graph: any, overrides: any = {}) {
    return {
      graph,
      budget: { maxStateNodes: 10 },
      navigator: { navigateFromNode: vi.fn().mockResolvedValue({ success: true }) },
      page: { url: () => "https://example.com", goto: vi.fn() },
      stagehand: { context: { pages: () => [] } },
      config: {
        targetUrl: "https://example.com",
        diffAware: { restrictToChanged: true, priorityBoost: 0.3 },
        ...overrides.config,
      },
      planner: { proposeTasks: vi.fn().mockReturnValue([]) },
      frontier: { enqueueMany: vi.fn() },
      mission: undefined,
      repoHints: undefined,
      memoryStore: undefined,
      diffContext: overrides.diffContext ?? undefined,
      ...overrides,
    } as any;
  }

  it("keeps nodes inside the diff scope", async () => {
    const { graph, source } = makeSourceGraph();
    const ctx = makeCtx(graph, {
      diffContext: {
        baseRef: "origin/main",
        changedFiles: [],
        affectedRoutes: ["/dashboard"],
        affectedApiEndpoints: [],
        affectedRouteFamilies: [],
      },
    });

    await expandGraph(ctx, source.id, {
      taskId: "t1", findings: [], evidence: [],
      coverageSnapshot: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
      followupRequests: [], outcome: "completed", summary: "ok",
      discoveredEdges: [makeEdge("https://example.com/dashboard", "fp-dash")],
    }, false);

    expect(graph.nodeCount()).toBe(2);
  });

  it("skips nodes outside the diff scope", async () => {
    const { graph, source } = makeSourceGraph();
    const ctx = makeCtx(graph, {
      diffContext: {
        baseRef: "origin/main",
        changedFiles: [],
        affectedRoutes: ["/dashboard"],
        affectedApiEndpoints: [],
        affectedRouteFamilies: [],
      },
    });

    await expandGraph(ctx, source.id, {
      taskId: "t1", findings: [], evidence: [],
      coverageSnapshot: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
      followupRequests: [], outcome: "completed", summary: "ok",
      discoveredEdges: [makeEdge("https://example.com/about", "fp-about")],
    }, false);

    expect(graph.nodeCount()).toBe(1); // only source
  });

  it("does not restrict when diff scope is empty", async () => {
    const { graph, source } = makeSourceGraph();
    const ctx = makeCtx(graph, {
      diffContext: {
        baseRef: "origin/main",
        changedFiles: [{ path: "README.md", status: "modified" }],
        affectedRoutes: [],
        affectedApiEndpoints: [],
        affectedRouteFamilies: [],
      },
    });

    await expandGraph(ctx, source.id, {
      taskId: "t1", findings: [], evidence: [],
      coverageSnapshot: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
      followupRequests: [], outcome: "completed", summary: "ok",
      discoveredEdges: [makeEdge("https://example.com/about", "fp-about")],
    }, false);

    // Should still add the node because scope is empty → no restriction
    expect(graph.nodeCount()).toBe(2);
  });
});
