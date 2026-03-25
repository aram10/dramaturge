import { describe, it, expect } from "vitest";
import { Planner } from "./planner.js";
import { StateGraph } from "../graph/state-graph.js";
import type { StateNode, MissionConfig, PageFingerprint } from "../types.js";

function makeFp(hash: string): PageFingerprint {
  return {
    normalizedPath: `/${hash}`,
    title: `Page ${hash}`,
    heading: `Heading ${hash}`,
    dialogTitles: [],
    hash,
  };
}

function makeGraph(): StateGraph {
  return new StateGraph();
}

describe("Planner", () => {
  describe("proposeTasks", () => {
    it("proposes a form worker for form pages", () => {
      const planner = new Planner();
      const graph = makeGraph();
      const node = graph.addNode({
        fingerprint: makeFp("form1"),
        pageType: "form",
        depth: 1,
      });

      const tasks = planner.proposeTasks(node, graph);
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      const workerTypes = tasks.map((t) => t.workerType);
      expect(workerTypes).toContain("form");
    });

    it("proposes navigation for dashboard pages", () => {
      const planner = new Planner();
      const graph = makeGraph();
      const node = graph.addNode({
        fingerprint: makeFp("dash"),
        pageType: "dashboard",
        depth: 0,
      });

      const tasks = planner.proposeTasks(node, graph);
      const workerTypes = tasks.map((t) => t.workerType);
      expect(workerTypes).toContain("navigation");
    });

    it("also proposes navigation for non-navigation pages (discovery)", () => {
      const planner = new Planner();
      const graph = makeGraph();
      const node = graph.addNode({
        fingerprint: makeFp("list1"),
        pageType: "list",
        depth: 1,
        // timesVisited defaults to 0
      });

      const tasks = planner.proposeTasks(node, graph);
      const workerTypes = tasks.map((t) => t.workerType);
      // list → crud worker + navigation discovery
      expect(workerTypes).toContain("crud");
      expect(workerTypes).toContain("navigation");
    });

    it("respects focusModes from mission config", () => {
      const planner = new Planner();
      const graph = makeGraph();
      const node = graph.addNode({
        fingerprint: makeFp("settings1"),
        pageType: "settings",
        depth: 1,
      });

      const mission: MissionConfig = {
        appDescription: "Test app",
        destructiveActionsAllowed: false,
        focusModes: ["form"], // only form workers
      };

      const tasks = planner.proposeTasks(node, graph, mission);
      const workerTypes = tasks.map((t) => t.workerType);
      // settings → form worker, but navigation should be excluded
      expect(workerTypes).toContain("form");
      expect(workerTypes).not.toContain("navigation");
    });

    it("generates tasks with valid frontier item structure", () => {
      const planner = new Planner();
      const graph = makeGraph();
      const node = graph.addNode({
        fingerprint: makeFp("detail1"),
        pageType: "detail",
        depth: 2,
      });

      const tasks = planner.proposeTasks(node, graph);
      for (const task of tasks) {
        expect(task.id).toMatch(/^task-/);
        expect(task.nodeId).toBe(node.id);
        expect(task.status).toBe("pending");
        expect(task.retryCount).toBe(0);
        expect(typeof task.priority).toBe("number");
        expect(task.priority).toBeGreaterThan(0);
      }
    });
  });

  describe("recordDispatch", () => {
    it("affects priority of subsequent proposals", () => {
      const planner = new Planner();
      const graph = makeGraph();
      const node = graph.addNode({
        fingerprint: makeFp("page1"),
        pageType: "form",
        depth: 0,
      });

      const firstTasks = planner.proposeTasks(node, graph);
      const firstFormPriority = firstTasks.find(
        (t) => t.workerType === "form"
      )?.priority;

      // Record that form worker was dispatched
      planner.recordDispatch(node.id, "form");

      const secondTasks = planner.proposeTasks(node, graph);
      const secondFormPriority = secondTasks.find(
        (t) => t.workerType === "form"
      )?.priority;

      // Second proposal should have lower priority (coverage gap goes to 0)
      expect(secondFormPriority).toBeLessThan(firstFormPriority!);
    });
  });

  describe("routeFollowup", () => {
    it("creates a frontier item from a followup request", () => {
      const planner = new Planner();
      const item = planner.routeFollowup(
        {
          type: "form",
          reason: "Need to test validation",
        },
        "node-source"
      );

      expect(item.id).toMatch(/^task-/);
      expect(item.nodeId).toBe("node-source");
      expect(item.workerType).toBe("form");
      expect(item.objective).toBe("Need to test validation");
      expect(item.status).toBe("pending");
    });

    it("uses targetNodeId when provided", () => {
      const planner = new Planner();
      const item = planner.routeFollowup(
        {
          type: "crud",
          reason: "Test CRUD on related page",
          targetNodeId: "node-target",
        },
        "node-source"
      );

      expect(item.nodeId).toBe("node-target");
    });
  });
});
