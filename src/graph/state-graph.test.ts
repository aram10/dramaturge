import { describe, it, expect } from "vitest";
import { StateGraph } from "./state-graph.js";
import type { PageFingerprint, DiscoveredEdge } from "../types.js";

function makeFp(hash: string): PageFingerprint {
  return {
    normalizedPath: `/${hash}`,
    signature: {
      pathname: `/${hash}`,
      query: [],
      uiMarkers: [],
    },
    title: `Page ${hash}`,
    heading: `Heading ${hash}`,
    dialogTitles: [],
    hash,
  };
}

describe("StateGraph", () => {
  describe("addNode / getNode", () => {
    it("creates a node with correct properties", () => {
      const graph = new StateGraph();
      const fp = makeFp("abc123");
      const node = graph.addNode({
        url: "https://example.com",
        title: "Home",
        fingerprint: fp,
        pageType: "dashboard",
        depth: 0,
      });

      expect(node.id).toMatch(/^node-/);
      expect(node.url).toBe("https://example.com");
      expect(node.title).toBe("Home");
      expect(node.fingerprint).toBe(fp);
      expect(node.pageType).toBe("dashboard");
      expect(node.depth).toBe(0);
      expect(node.timesVisited).toBe(0);
      expect(node.controlsDiscovered).toEqual([]);
      expect(node.controlsExercised).toEqual([]);
      expect(node.tags).toEqual([]);
      expect(node.riskScore).toBe(0);
    });

    it("retrieves a node by id", () => {
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: makeFp("abc"),
        pageType: "form",
        depth: 1,
      });

      const retrieved = graph.getNode(node.id);
      expect(retrieved).toBe(node);
    });

    it("throws for unknown node id", () => {
      const graph = new StateGraph();
      expect(() => graph.getNode("node-nonexistent")).toThrow(
        "StateNode not found: node-nonexistent"
      );
    });

    it("respects custom riskScore", () => {
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: makeFp("risky"),
        pageType: "settings",
        depth: 0,
        riskScore: 0.9,
      });
      expect(node.riskScore).toBe(0.9);
    });
  });

  describe("findByFingerprint", () => {
    it("finds an existing node by fingerprint hash", () => {
      const graph = new StateGraph();
      const fp = makeFp("match-me");
      const node = graph.addNode({
        fingerprint: fp,
        pageType: "list",
        depth: 0,
      });

      const found = graph.findByFingerprint(fp);
      expect(found).toBe(node);
    });

    it("returns undefined for unknown fingerprint", () => {
      const graph = new StateGraph();
      graph.addNode({
        fingerprint: makeFp("aaa"),
        pageType: "form",
        depth: 0,
      });

      const result = graph.findByFingerprint(makeFp("zzz"));
      expect(result).toBeUndefined();
    });
  });

  describe("addEdge", () => {
    it("creates an edge between two nodes", () => {
      const graph = new StateGraph();
      const a = graph.addNode({
        fingerprint: makeFp("a"),
        pageType: "dashboard",
        depth: 0,
      });
      const b = graph.addNode({
        fingerprint: makeFp("b"),
        pageType: "form",
        depth: 1,
      });

      const discoveredEdge: DiscoveredEdge = {
        actionLabel: "Click Create",
        navigationHint: { selector: "#create-btn" },
        targetFingerprint: makeFp("b"),
        targetPageType: "form",
      };

      const edge = graph.addEdge(a.id, b.id, discoveredEdge);
      expect(edge.id).toMatch(/^edge-/);
      expect(edge.fromNodeId).toBe(a.id);
      expect(edge.toNodeId).toBe(b.id);
      expect(edge.actionLabel).toBe("Click Create");
      expect(edge.outcome).toBe("success");
    });
  });

  describe("pathToNode (BFS)", () => {
    it("returns empty array for root node", () => {
      const graph = new StateGraph();
      const root = graph.addNode({
        fingerprint: makeFp("root"),
        pageType: "dashboard",
        depth: 0,
      });
      expect(graph.pathToNode(root.id)).toEqual([]);
    });

    it("finds a direct path from root to child", () => {
      const graph = new StateGraph();
      const root = graph.addNode({
        fingerprint: makeFp("root"),
        pageType: "dashboard",
        depth: 0,
      });
      const child = graph.addNode({
        fingerprint: makeFp("child"),
        pageType: "form",
        depth: 1,
      });

      const edge = graph.addEdge(root.id, child.id, {
        actionLabel: "Click link",
        navigationHint: { url: "/child" },
        targetFingerprint: makeFp("child"),
        targetPageType: "form",
      });

      const path = graph.pathToNode(child.id);
      expect(path).toHaveLength(1);
      expect(path[0].id).toBe(edge.id);
    });

    it("finds multi-hop path", () => {
      const graph = new StateGraph();
      const root = graph.addNode({
        fingerprint: makeFp("r"),
        pageType: "dashboard",
        depth: 0,
      });
      const mid = graph.addNode({
        fingerprint: makeFp("m"),
        pageType: "list",
        depth: 1,
      });
      const leaf = graph.addNode({
        fingerprint: makeFp("l"),
        pageType: "detail",
        depth: 2,
      });

      graph.addEdge(root.id, mid.id, {
        actionLabel: "Go to list",
        navigationHint: { url: "/list" },
        targetFingerprint: makeFp("m"),
        targetPageType: "list",
      });
      graph.addEdge(mid.id, leaf.id, {
        actionLabel: "Open detail",
        navigationHint: { selector: ".row" },
        targetFingerprint: makeFp("l"),
        targetPageType: "detail",
      });

      const path = graph.pathToNode(leaf.id);
      expect(path).toHaveLength(2);
      expect(path[0].fromNodeId).toBe(root.id);
      expect(path[0].toNodeId).toBe(mid.id);
      expect(path[1].fromNodeId).toBe(mid.id);
      expect(path[1].toNodeId).toBe(leaf.id);
    });

    it("returns empty for unreachable node", () => {
      const graph = new StateGraph();
      graph.addNode({
        fingerprint: makeFp("root"),
        pageType: "dashboard",
        depth: 0,
      });
      const orphan = graph.addNode({
        fingerprint: makeFp("orphan"),
        pageType: "form",
        depth: 1,
      });
      // No edge connecting root → orphan
      expect(graph.pathToNode(orphan.id)).toEqual([]);
    });
  });

  describe("nodeCount / getAllNodes / getAllEdges", () => {
    it("tracks node and edge counts", () => {
      const graph = new StateGraph();
      expect(graph.nodeCount()).toBe(0);
      expect(graph.getAllNodes()).toEqual([]);

      const a = graph.addNode({
        fingerprint: makeFp("a"),
        pageType: "dashboard",
        depth: 0,
      });
      expect(graph.nodeCount()).toBe(1);

      const b = graph.addNode({
        fingerprint: makeFp("b"),
        pageType: "form",
        depth: 1,
      });
      expect(graph.nodeCount()).toBe(2);

      graph.addEdge(a.id, b.id, {
        actionLabel: "test",
        navigationHint: {},
        targetFingerprint: makeFp("b"),
        targetPageType: "form",
      });
      expect(graph.getAllEdges()).toHaveLength(1);
    });
  });

  describe("summary", () => {
    it("produces a human-readable summary", () => {
      const graph = new StateGraph();
      graph.addNode({
        url: "https://example.com",
        fingerprint: makeFp("root"),
        pageType: "dashboard",
        depth: 0,
      });

      const summary = graph.summary();
      expect(summary).toContain("State graph: 1 nodes, 0 edges");
      expect(summary).toContain("dashboard");
      expect(summary).toContain("depth=0");
    });
  });

  describe("mutation methods", () => {
    it("recordVisit increments timesVisited", () => {
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: makeFp("v"),
        pageType: "form",
        depth: 0,
      });
      expect(node.timesVisited).toBe(0);

      graph.recordVisit(node.id);
      expect(node.timesVisited).toBe(1);

      graph.recordVisit(node.id);
      expect(node.timesVisited).toBe(2);
    });

    it("addDiscoveredControl deduplicates", () => {
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: makeFp("d"),
        pageType: "form",
        depth: 0,
      });

      graph.addDiscoveredControl(node.id, "btn-save");
      graph.addDiscoveredControl(node.id, "btn-save");
      graph.addDiscoveredControl(node.id, "btn-cancel");
      expect(node.controlsDiscovered).toEqual(["btn-save", "btn-cancel"]);
    });

    it("addExercisedControl deduplicates", () => {
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: makeFp("e"),
        pageType: "form",
        depth: 0,
      });

      graph.addExercisedControl(node.id, "input-name");
      graph.addExercisedControl(node.id, "input-name");
      expect(node.controlsExercised).toEqual(["input-name"]);
    });
  });

  describe("toMermaid", () => {
    it("renders an empty graph", () => {
      const graph = new StateGraph();
      expect(graph.toMermaid()).toBe("graph TD");
    });

    it("renders nodes and edges as a Mermaid flowchart", () => {
      const graph = new StateGraph();
      const a = graph.addNode({
        fingerprint: makeFp("m1"),
        pageType: "dashboard",
        title: "Home",
        depth: 0,
      });
      const b = graph.addNode({
        fingerprint: makeFp("m2"),
        pageType: "form",
        title: "Login",
        depth: 1,
      });
      graph.addEdge(a.id, b.id, {
        actionLabel: "Click login",
        navigationHint: {},
        targetFingerprint: makeFp("m2"),
        targetPageType: "form",
      });

      const mermaid = graph.toMermaid();
      expect(mermaid).toContain("graph TD");
      expect(mermaid).toContain(`${a.id}["dashboard: Home"]`);
      expect(mermaid).toContain(`${b.id}["form: Login"]`);
      expect(mermaid).toContain(`${a.id} -->|"Click login"| ${b.id}`);
    });

    it("escapes double quotes in labels", () => {
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: makeFp("m3"),
        pageType: "detail",
        title: 'Item "Special"',
        depth: 0,
      });

      const mermaid = graph.toMermaid();
      expect(mermaid).toContain('#quot;');
      expect(mermaid).not.toContain('"Special"');
    });
  });
});
