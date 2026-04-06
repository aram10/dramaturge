import { describe, it, expect } from "vitest";
import { Coordinator } from "./coordinator.js";
import { Blackboard } from "./blackboard.js";
import { MessageBus } from "./message-bus.js";
import { StateGraph } from "../graph/state-graph.js";
import type { FrontierItem } from "../types.js";

function makeItem(overrides: Partial<FrontierItem> = {}): FrontierItem {
  return {
    id: "task-test-1",
    nodeId: "node-1",
    workerType: "navigation",
    objective: "Explore the home page",
    priority: 0.7,
    reason: "Auto-assigned",
    retryCount: 0,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

function makeCoordinator() {
  const blackboard = new Blackboard();
  const messageBus = new MessageBus();
  const coordinator = new Coordinator({ blackboard, messageBus });
  return { coordinator, blackboard, messageBus };
}

describe("Coordinator", () => {
  describe("agent management", () => {
    it("lists all five agents", () => {
      const { coordinator } = makeCoordinator();
      const agents = coordinator.listAgents();
      expect(agents).toHaveLength(5);
      const roles = agents.map((a) => a.role);
      expect(roles).toContain("scout");
      expect(roles).toContain("tester");
      expect(roles).toContain("security");
      expect(roles).toContain("reviewer");
      expect(roles).toContain("reporter");
    });

    it("gets agent by role", () => {
      const { coordinator } = makeCoordinator();
      const scout = coordinator.getAgent("scout");
      expect(scout?.id).toBe("agent-scout");
    });

    it("resolves agent role from worker type", () => {
      const { coordinator } = makeCoordinator();
      expect(coordinator.resolveAgentRole("navigation")).toBe("scout");
      expect(coordinator.resolveAgentRole("form")).toBe("tester");
      expect(coordinator.resolveAgentRole("crud")).toBe("tester");
      expect(coordinator.resolveAgentRole("api")).toBe("tester");
      expect(coordinator.resolveAgentRole("adversarial")).toBe("security");
    });
  });

  describe("task assignment", () => {
    it("assigns a navigation task to the scout agent", () => {
      const { coordinator, blackboard, messageBus } = makeCoordinator();
      const item = makeItem({ workerType: "navigation" });

      const task = coordinator.assignTask(item);

      expect(task.id).toMatch(/^a2a-/);
      expect(task.assignedAgent).toBe("agent-scout");
      expect(task.status).toBe("submitted");
      expect(task.history).toHaveLength(1);
      expect(task.metadata?.workerType).toBe("navigation");
      expect(task.metadata?.objective).toBe("Explore the home page");

      // Check blackboard entry
      const directives = blackboard.query("directive");
      expect(directives.length).toBeGreaterThanOrEqual(1);
      const assignment = directives.find(
        (d) => (d.data as any).type === "task-assigned"
      );
      expect(assignment).toBeDefined();
      expect(assignment?.data.agentRole).toBe("scout");

      // Check message sent to agent
      expect(messageBus.size()).toBeGreaterThanOrEqual(1);
    });

    it("assigns a form task to the tester agent", () => {
      const { coordinator } = makeCoordinator();
      const item = makeItem({ workerType: "form", objective: "Test login form" });

      const task = coordinator.assignTask(item);
      expect(task.assignedAgent).toBe("agent-tester");
    });

    it("assigns an adversarial task to the security agent", () => {
      const { coordinator } = makeCoordinator();
      const item = makeItem({ workerType: "adversarial" });

      const task = coordinator.assignTask(item);
      expect(task.assignedAgent).toBe("agent-security");
    });
  });

  describe("task lifecycle", () => {
    it("updates task status through the lifecycle", () => {
      const { coordinator, blackboard } = makeCoordinator();
      const item = makeItem();
      const task = coordinator.assignTask(item);

      coordinator.updateTaskStatus(task.id, "working");
      expect(coordinator.getTask(task.id)?.status).toBe("working");
      expect(coordinator.getTask(task.id)?.history).toHaveLength(2);

      coordinator.updateTaskStatus(task.id, "completed");
      expect(coordinator.getTask(task.id)?.status).toBe("completed");
      expect(coordinator.getTask(task.id)?.history).toHaveLength(3);

      // Should have posted status updates to the blackboard
      const statusUpdates = blackboard
        .query("directive")
        .filter((d) => (d.data as any).type === "task-status-update");
      expect(statusUpdates.length).toBeGreaterThanOrEqual(2);
    });

    it("completes a task and posts findings to the blackboard", () => {
      const { coordinator, blackboard, messageBus } = makeCoordinator();
      const item = makeItem();
      const task = coordinator.assignTask(item);

      coordinator.completeTask(task.id, "Found 2 bugs", 2);

      expect(coordinator.getTask(task.id)?.status).toBe("completed");

      // Should post finding entry
      const findings = blackboard.query("finding");
      expect(findings.length).toBeGreaterThanOrEqual(1);

      // Should notify reviewer when findings exist
      const reviewerMsgs = messageBus.getMessagesTo("agent-reviewer");
      expect(reviewerMsgs.length).toBeGreaterThanOrEqual(1);
    });

    it("does not notify reviewer when zero findings", () => {
      const { coordinator, messageBus } = makeCoordinator();
      const item = makeItem();
      const task = coordinator.assignTask(item);

      // Clear any assignment messages
      const initialReviewerMsgs = messageBus.getMessagesTo("agent-reviewer").length;

      coordinator.completeTask(task.id, "No issues", 0);

      // Reviewer should not receive extra messages for zero findings
      const finalReviewerMsgs = messageBus.getMessagesTo("agent-reviewer").length;
      expect(finalReviewerMsgs).toBe(initialReviewerMsgs);
    });

    it("getActiveTasks excludes completed and failed tasks", () => {
      const { coordinator } = makeCoordinator();

      const item1 = makeItem({ id: "t1", workerType: "navigation" });
      const item2 = makeItem({ id: "t2", workerType: "form" });
      const item3 = makeItem({ id: "t3", workerType: "adversarial" });

      const task1 = coordinator.assignTask(item1);
      const task2 = coordinator.assignTask(item2);
      coordinator.assignTask(item3);

      coordinator.updateTaskStatus(task1.id, "completed");
      coordinator.updateTaskStatus(task2.id, "failed");

      const active = coordinator.getActiveTasks();
      expect(active).toHaveLength(1);
      expect(active[0].assignedAgent).toBe("agent-security");
    });
  });

  describe("broadcastDirective", () => {
    it("broadcasts to all agents via the message bus", () => {
      const { coordinator, messageBus, blackboard } = makeCoordinator();

      coordinator.broadcastDirective(
        "agent-reviewer",
        "Focus on form validation",
        { urgency: "high" }
      );

      expect(messageBus.size()).toBe(1);
      const history = messageBus.getHistory();
      expect(history[0].toAgent).toBe("*");
      expect(history[0].fromAgent).toBe("agent-reviewer");

      const directives = blackboard.query("directive");
      expect(directives.some((d) => (d.data as any).type === "broadcast")).toBe(true);
    });
  });

  describe("inherits Planner functionality", () => {
    it("can propose tasks (inherited from Planner)", () => {
      const { coordinator } = makeCoordinator();
      const graph = new StateGraph();
      const node = graph.addNode({
        fingerprint: {
          normalizedPath: "/test",
          signature: { pathname: "/test", query: [], uiMarkers: [] },
          title: "Test",
          heading: "Test",
          dialogTitles: [],
          hash: "test-hash",
        },
        pageType: "form",
        depth: 0,
      });

      const tasks = coordinator.proposeTasks(node, graph);
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.some((t) => t.workerType === "form")).toBe(true);
    });

    it("can record dispatch and route followups (inherited from Planner)", () => {
      const { coordinator } = makeCoordinator();

      coordinator.recordDispatch("node-1", "form");
      expect(coordinator.snapshotDispatchState()).toEqual({
        "node-1": ["form"],
      });

      const item = coordinator.routeFollowup(
        { type: "crud", reason: "Test CRUD" },
        "node-1"
      );
      expect(item.workerType).toBe("crud");
      expect(item.objective).toBe("Test CRUD");
    });
  });
});
