import { describe, expect, it } from "vitest";
import { FrontierQueue } from "../graph/frontier.js";
import { StateGraph } from "../graph/state-graph.js";
import { Planner } from "../planner/planner.js";
import type { NavigationMemorySnapshot } from "./types.js";
import { seedGraphFromNavigationMemory } from "./navigation-cache.js";

function makeSnapshot(): NavigationMemorySnapshot {
  return {
    targetOrigin: "https://example.com",
    savedAt: "2026-03-27T12:00:00.000Z",
    nodes: [
      {
        id: "node-root",
        url: "https://example.com",
        title: "Home",
        fingerprint: {
          normalizedPath: "/",
          signature: {
            pathname: "/",
            query: [],
            uiMarkers: [],
          },
          title: "Home",
          heading: "Home",
          dialogTitles: [],
          hash: "root",
        },
        pageType: "dashboard",
        depth: 0,
        firstSeenAt: "2026-03-27T12:00:00.000Z",
        controlsDiscovered: ["settings-link"],
        controlsExercised: ["settings-link"],
        tags: [],
        riskScore: 0.4,
        timesVisited: 2,
      },
      {
        id: "node-settings",
        url: "https://example.com/settings",
        title: "Settings",
        fingerprint: {
          normalizedPath: "/settings",
          signature: {
            pathname: "/settings",
            query: [],
            uiMarkers: [],
          },
          title: "Settings",
          heading: "Settings",
          dialogTitles: [],
          hash: "settings",
        },
        pageType: "settings",
        depth: 1,
        firstSeenAt: "2026-03-27T12:00:00.000Z",
        controlsDiscovered: ["save-button", "members-link"],
        controlsExercised: [],
        navigationHint: {
          selector: "role=button[name=Settings]",
          actionDescription: "Open settings",
        },
        tags: [],
        riskScore: 0.2,
        timesVisited: 1,
      },
    ],
    edges: [
      {
        id: "edge-root-settings",
        fromNodeId: "node-root",
        toNodeId: "node-settings",
        actionLabel: "Open settings",
        navigationHint: {
          selector: "role=button[name=Settings]",
          actionDescription: "Open settings",
        },
        outcome: "success",
        timestamp: "2026-03-27T12:00:00.000Z",
      },
    ],
  };
}

describe("seedGraphFromNavigationMemory", () => {
  it("restores states and seeds follow-up work for nodes with coverage gaps", () => {
    const graph = new StateGraph();
    const frontier = new FrontierQueue();
    const planner = new Planner();

    const result = seedGraphFromNavigationMemory({
      graph,
      frontier,
      planner,
      snapshot: makeSnapshot(),
    });

    expect(result).toEqual({
      restoredNodeCount: 2,
      restoredEdgeCount: 1,
      seededTaskCount: expect.any(Number),
    });
    expect(graph.nodeCount()).toBe(2);
    expect(graph.getAllEdges()).toHaveLength(1);
    expect(frontier.size()).toBeGreaterThan(0);
  });
});
