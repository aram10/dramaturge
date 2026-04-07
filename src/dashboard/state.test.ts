import { describe, expect, it } from "vitest";
import {
  initialDashboardState,
  applyRunStart,
  applyRunEnd,
  applyTaskStart,
  applyTaskComplete,
  applyFinding,
  applyStateDiscovered,
  applyProgress,
  applyError,
  applyA2ATask,
  applyA2AMessage,
  applyA2ABlackboard,
} from "./state.js";

describe("initialDashboardState", () => {
  it("returns zeroed-out default state", () => {
    const state = initialDashboardState();
    expect(state.running).toBe(false);
    expect(state.finished).toBe(false);
    expect(state.tasksExecuted).toBe(0);
    expect(state.totalFindings).toBe(0);
    expect(state.activity).toHaveLength(0);
    expect(state.lastError).toBeUndefined();
  });
});

describe("applyRunStart", () => {
  it("sets target URL, budget and concurrency", () => {
    const state = applyRunStart(initialDashboardState(), {
      targetUrl: "https://example.com",
      timestamp: "2026-01-01T00:00:00Z",
      budget: { timeLimitSeconds: 300, maxStepsPerTask: 10 },
      concurrency: 4,
    });
    expect(state.targetUrl).toBe("https://example.com");
    expect(state.running).toBe(true);
    expect(state.finished).toBe(false);
    expect(state.timeLimitSeconds).toBe(300);
    expect(state.concurrency).toBe(4);
  });
});

describe("applyRunEnd", () => {
  it("marks run as finished with final stats", () => {
    let state = applyRunStart(initialDashboardState(), {
      targetUrl: "https://example.com",
      timestamp: "2026-01-01T00:00:00Z",
      budget: { timeLimitSeconds: 300, maxStepsPerTask: 10 },
      concurrency: 2,
    });
    state = applyRunEnd(state, {
      timestamp: "2026-01-01T00:05:00Z",
      tasksExecuted: 10,
      totalFindings: 3,
      statesDiscovered: 5,
      blindSpots: 1,
      durationMs: 300_000,
    });
    expect(state.running).toBe(false);
    expect(state.finished).toBe(true);
    expect(state.tasksExecuted).toBe(10);
    expect(state.totalFindings).toBe(3);
    expect(state.statesDiscovered).toBe(5);
    expect(state.durationMs).toBe(300_000);
    expect(state.estimatedProgress).toBe(1);
  });
});

describe("applyTaskStart", () => {
  it("adds task start entry to activity feed with provided timestamp", () => {
    const state = applyTaskStart(initialDashboardState(), {
      taskId: "t1",
      taskNumber: 1,
      nodeId: "n1",
      workerType: "navigation",
      objective: "Explore home page",
    }, 1000);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("task-start");
    expect(state.activity[0].text).toContain("[task 1]");
    expect(state.activity[0].text).toContain("navigation");
    expect(state.activity[0].text).toContain("Explore home page");
    expect(state.activity[0].timestamp).toBe(1000);
    expect(state.activity[0].id).toBe(1);
  });
});

describe("applyTaskComplete", () => {
  it("adds task complete entry with coverage info", () => {
    const state = applyTaskComplete(initialDashboardState(), {
      taskId: "t1",
      taskNumber: 1,
      nodeId: "n1",
      outcome: "completed",
      findingsCount: 2,
      coverageExercised: 5,
      coverageDiscovered: 10,
    });
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("task-complete");
    expect(state.activity[0].text).toContain("completed");
    expect(state.activity[0].text).toContain("2 finding(s)");
    expect(state.activity[0].text).toContain("coverage: 5/10");
  });

  it("omits coverage when zero", () => {
    const state = applyTaskComplete(initialDashboardState(), {
      taskId: "t1",
      taskNumber: 1,
      nodeId: "n1",
      outcome: "blocked",
      findingsCount: 0,
      coverageExercised: 0,
      coverageDiscovered: 0,
    });
    expect(state.activity[0].text).not.toContain("coverage");
  });
});

describe("applyFinding", () => {
  it("adds finding entry with severity", () => {
    const state = applyFinding(initialDashboardState(), {
      taskId: "t1",
      title: "Broken link",
      severity: "Critical",
      category: "Bug",
    });
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("finding");
    expect(state.activity[0].text).toContain("⚠");
    expect(state.activity[0].text).toContain("[Critical]");
    expect(state.activity[0].text).toContain("Broken link");
  });
});

describe("applyStateDiscovered", () => {
  it("adds state discovered entry", () => {
    const state = applyStateDiscovered(initialDashboardState(), {
      nodeId: "n2",
      url: "https://example.com/about",
      pageType: "detail",
      depth: 1,
      totalStates: 3,
    });
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("state-discovered");
    expect(state.activity[0].text).toContain("new state");
    expect(state.activity[0].text).toContain("detail");
    expect(state.activity[0].text).toContain("3 total");
  });
});

describe("applyProgress", () => {
  it("updates stats counters", () => {
    const state = applyProgress(initialDashboardState(), {
      tasksExecuted: 5,
      tasksRemaining: 10,
      totalFindings: 2,
      statesDiscovered: 4,
      elapsedMs: 30_000,
      estimatedProgress: 0.33,
    });
    expect(state.tasksExecuted).toBe(5);
    expect(state.tasksRemaining).toBe(10);
    expect(state.totalFindings).toBe(2);
    expect(state.statesDiscovered).toBe(4);
    expect(state.elapsedMs).toBe(30_000);
    expect(state.estimatedProgress).toBe(0.33);
  });
});

describe("applyError", () => {
  it("adds error to activity and sets lastError", () => {
    const state = applyError(initialDashboardState(), {
      message: "Browser crashed",
      phase: "engine",
    });
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("error");
    expect(state.activity[0].text).toContain("Error");
    expect(state.activity[0].text).toContain("Browser crashed");
    expect(state.lastError).toBe("Browser crashed");
  });
});

describe("activity feed capping", () => {
  it("caps activity at 50 items with newest first", () => {
    let state = initialDashboardState();
    for (let i = 0; i < 60; i++) {
      state = applyTaskStart(state, {
        taskId: `t${i}`,
        taskNumber: i,
        nodeId: `n${i}`,
        workerType: "navigation",
        objective: `Task ${i}`,
      }, 1000 + i);
    }
    expect(state.activity).toHaveLength(50);
    // Newest item should be first
    expect(state.activity[0].text).toContain("Task 59");
  });

  it("assigns monotonically increasing IDs across activity items", () => {
    let state = initialDashboardState();
    state = applyTaskStart(state, {
      taskId: "t1",
      taskNumber: 1,
      nodeId: "n1",
      workerType: "navigation",
      objective: "First",
    }, 1000);
    state = applyFinding(state, {
      taskId: "t1",
      title: "Bug",
      severity: "Medium",
      category: "Bug",
    }, 2000);
    expect(state.activity[0].id).toBe(2);
    expect(state.activity[1].id).toBe(1);
  });
});

// --- A2A reducer tests ---

describe("initialDashboardState A2A fields", () => {
  it("starts with A2A disabled and empty agent map", () => {
    const state = initialDashboardState();
    expect(state.a2aEnabled).toBe(false);
    expect(state.agents).toEqual({});
    expect(state.a2aTasksTotal).toBe(0);
    expect(state.a2aMessagesTotal).toBe(0);
    expect(state.a2aBlackboardTotal).toBe(0);
  });
});

describe("applyA2ATask", () => {
  it("creates agent entry and adds activity on submitted task", () => {
    const state = applyA2ATask(initialDashboardState(), {
      taskId: "a2a-1",
      agentId: "agent-scout",
      agentRole: "scout",
      status: "submitted",
      objective: "Map the home page",
    }, 5000);

    expect(state.a2aEnabled).toBe(true);
    expect(state.a2aTasksTotal).toBe(1);
    expect(state.agents["agent-scout"]).toBeDefined();
    expect(state.agents["agent-scout"].role).toBe("scout");
    expect(state.agents["agent-scout"].tasksAssigned).toBe(1);
    expect(state.agents["agent-scout"].currentStatus).toBe("working");
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("a2a-task");
    expect(state.activity[0].text).toContain("scout");
    expect(state.activity[0].text).toContain("Map the home page");
    expect(state.activity[0].timestamp).toBe(5000);
  });

  it("increments completed count on completed task", () => {
    let state = applyA2ATask(initialDashboardState(), {
      taskId: "a2a-1",
      agentId: "agent-tester",
      agentRole: "tester",
      status: "working",
      objective: "Test form",
    }, 1000);

    state = applyA2ATask(state, {
      taskId: "a2a-1",
      agentId: "agent-tester",
      agentRole: "tester",
      status: "completed",
      objective: "Test form",
    }, 2000);

    expect(state.agents["agent-tester"].tasksAssigned).toBe(1);
    expect(state.agents["agent-tester"].tasksCompleted).toBe(1);
    expect(state.agents["agent-tester"].currentStatus).toBe("completed");
    expect(state.a2aTasksTotal).toBe(2);
  });

  it("uses correct status icons in activity text", () => {
    const submitted = applyA2ATask(initialDashboardState(), {
      taskId: "a2a-1",
      agentId: "agent-scout",
      agentRole: "scout",
      status: "submitted",
      objective: "Explore",
    });
    expect(submitted.activity[0].text).toContain("→");

    const completed = applyA2ATask(initialDashboardState(), {
      taskId: "a2a-2",
      agentId: "agent-scout",
      agentRole: "scout",
      status: "completed",
      objective: "Explore",
    });
    expect(completed.activity[0].text).toContain("✓");

    const working = applyA2ATask(initialDashboardState(), {
      taskId: "a2a-3",
      agentId: "agent-scout",
      agentRole: "scout",
      status: "working",
      objective: "Explore",
    });
    expect(working.activity[0].text).toContain("●");
  });
});

describe("applyA2AMessage", () => {
  it("adds message activity and increments message count", () => {
    const state = applyA2AMessage(initialDashboardState(), {
      fromAgent: "agent-tester",
      toAgent: "agent-reviewer",
      text: "Found 3 issues in login form",
    }, 3000);

    expect(state.a2aEnabled).toBe(true);
    expect(state.a2aMessagesTotal).toBe(1);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("a2a-message");
    expect(state.activity[0].text).toContain("agent-tester");
    expect(state.activity[0].text).toContain("agent-reviewer");
    expect(state.activity[0].text).toContain("Found 3 issues");
    expect(state.activity[0].timestamp).toBe(3000);
  });

  it("shows 'all' for broadcast messages", () => {
    const state = applyA2AMessage(initialDashboardState(), {
      fromAgent: "coordinator",
      toAgent: "*",
      text: "Redirect focus to forms",
    });

    expect(state.activity[0].text).toContain("all");
    expect(state.activity[0].text).not.toContain("*");
  });

  it("increments messagesSent on an already-tracked sender agent", () => {
    let state = applyA2ATask(initialDashboardState(), {
      taskId: "a2a-1",
      agentId: "agent-tester",
      agentRole: "tester",
      status: "working",
      objective: "Test form",
    }, 1000);

    expect(state.agents["agent-tester"].messagesSent).toBe(0);

    state = applyA2AMessage(state, {
      fromAgent: "agent-tester",
      toAgent: "agent-reviewer",
      text: "Found issue",
    }, 2000);

    expect(state.agents["agent-tester"].messagesSent).toBe(1);
  });

  it("does not create agent entry for unknown sender", () => {
    const state = applyA2AMessage(initialDashboardState(), {
      fromAgent: "unknown-agent",
      toAgent: "agent-reviewer",
      text: "Hello",
    });

    expect(state.agents["unknown-agent"]).toBeUndefined();
  });
});

describe("applyA2ABlackboard", () => {
  it("adds blackboard activity and tracks agent posts", () => {
    const state = applyA2ABlackboard(initialDashboardState(), {
      kind: "finding",
      agentId: "agent-tester",
      summary: "Broken save button",
    }, 4000);

    expect(state.a2aEnabled).toBe(true);
    expect(state.a2aBlackboardTotal).toBe(1);
    expect(state.agents["agent-tester"]).toBeDefined();
    expect(state.agents["agent-tester"].blackboardPosts).toBe(1);
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0].kind).toBe("a2a-blackboard");
    expect(state.activity[0].text).toContain("finding");
    expect(state.activity[0].text).toContain("agent-tester");
    expect(state.activity[0].text).toContain("Broken save button");
    expect(state.activity[0].timestamp).toBe(4000);
  });

  it("infers role from agent id", () => {
    const state = applyA2ABlackboard(initialDashboardState(), {
      kind: "navigation",
      agentId: "agent-scout",
      summary: "Discovered /settings",
    });

    expect(state.agents["agent-scout"].role).toBe("scout");
  });

  it("accumulates blackboard posts per agent", () => {
    let state = applyA2ABlackboard(initialDashboardState(), {
      kind: "finding",
      agentId: "agent-security",
      summary: "XSS in search",
    });
    state = applyA2ABlackboard(state, {
      kind: "finding",
      agentId: "agent-security",
      summary: "CSRF in form",
    });

    expect(state.agents["agent-security"].blackboardPosts).toBe(2);
    expect(state.a2aBlackboardTotal).toBe(2);
  });
});

describe("A2A + engine events interleave", () => {
  it("mixes A2A and engine activity items in the feed", () => {
    let state = initialDashboardState();
    state = applyTaskStart(state, {
      taskId: "t1",
      taskNumber: 1,
      nodeId: "n1",
      workerType: "navigation",
      objective: "Explore home",
    }, 1000);
    state = applyA2ATask(state, {
      taskId: "a2a-1",
      agentId: "agent-scout",
      agentRole: "scout",
      status: "submitted",
      objective: "Map surface area",
    }, 2000);
    state = applyA2AMessage(state, {
      fromAgent: "agent-scout",
      toAgent: "agent-reviewer",
      text: "Found new routes",
    }, 3000);

    expect(state.activity).toHaveLength(3);
    expect(state.activity[0].kind).toBe("a2a-message");
    expect(state.activity[1].kind).toBe("a2a-task");
    expect(state.activity[2].kind).toBe("task-start");
  });
});
