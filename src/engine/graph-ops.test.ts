import { describe, expect, it, vi } from "vitest";
import { StateGraph } from "../graph/state-graph.js";
import { expandGraph } from "./graph-ops.js";

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
