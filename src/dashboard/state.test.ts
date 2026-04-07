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
