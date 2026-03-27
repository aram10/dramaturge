import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  actionRecorderCtor,
  startMock,
  stopMock,
  getActionsMock,
  executeMock,
  stagehandAgentMock,
} = vi.hoisted(() => ({
  actionRecorderCtor: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  getActionsMock: vi.fn().mockReturnValue([]),
  executeMock: vi.fn(),
  stagehandAgentMock: vi.fn(),
}));

vi.mock("./action-recorder.js", () => ({
  ActionRecorder: actionRecorderCtor,
}));

vi.mock("./tools.js", () => ({
  createWorkerTools: vi.fn().mockReturnValue({}),
}));

vi.mock("./prompts.js", () => ({
  buildWorkerSystemPrompt: vi.fn().mockReturnValue("system prompt"),
}));

import { executeWorkerTask } from "./worker.js";

describe("executeWorkerTask", () => {
  beforeEach(() => {
    startMock.mockReset();
    stopMock.mockReset();
    getActionsMock.mockReset();
    getActionsMock.mockReturnValue([]);
    executeMock.mockReset();
    stagehandAgentMock.mockReset();
    actionRecorderCtor.mockReset();

    actionRecorderCtor.mockImplementation(function ActionRecorderMock() {
      return {
        start: startMock,
        stop: stopMock,
        getActions: getActionsMock,
        getRecentSummaries: vi.fn().mockReturnValue([]),
        getRecentActionIds: vi.fn().mockReturnValue([]),
        recordToolAction: vi.fn(),
        recordControlAction: vi.fn(),
      };
    });

    stagehandAgentMock.mockReturnValue({
      execute: executeMock,
    });
  });

  it("stops the action recorder after a successful worker run", async () => {
    executeMock.mockResolvedValue({});

    const stagehand = {
      context: {
        pages: () => [{}],
      },
      agent: stagehandAgentMock,
    } as any;

    await executeWorkerTask(
      stagehand,
      {
        id: "task-1",
        workerType: "navigation",
        nodeId: "node-1",
        objective: "Inspect the page",
        maxSteps: 5,
        pageType: "landing",
        missionContext: "Example app",
      },
      "anthropic/claude-haiku-4-5",
      "C:/tmp/screenshots"
    );

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("stops the action recorder after a failed worker run", async () => {
    executeMock.mockRejectedValue(new Error("boom"));

    const stagehand = {
      context: {
        pages: () => [{}],
      },
      agent: stagehandAgentMock,
    } as any;

    await executeWorkerTask(
      stagehand,
      {
        id: "task-2",
        workerType: "crud",
        nodeId: "node-2",
        objective: "Break the page",
        maxSteps: 5,
        pageType: "list",
        missionContext: "Example app",
      },
      "anthropic/claude-haiku-4-5",
      "C:/tmp/screenshots"
    );

    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
