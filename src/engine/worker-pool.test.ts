import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  stagehandCtor,
  authenticateMock,
  applyStorageStateMock,
} = vi.hoisted(() => ({
  stagehandCtor: vi.fn(),
  authenticateMock: vi.fn(),
  applyStorageStateMock: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  Stagehand: stagehandCtor,
}));

vi.mock("../auth/authenticator.js", () => ({
  authenticate: authenticateMock,
}));

vi.mock("../auth/storage-state.js", () => ({
  applyStorageState: applyStorageStateMock,
}));

import { createStagehand, initWorkerPool } from "./worker-pool.js";

describe("worker-pool", () => {
  beforeEach(() => {
    stagehandCtor.mockReset();
    authenticateMock.mockReset();
    applyStorageStateMock.mockReset();

    stagehandCtor.mockImplementation(function StagehandMock(this: any, options: unknown) {
      this.options = options;
      this.init = vi.fn().mockResolvedValue(undefined);
      this.context = {
        pages: () => [{ name: "page" }],
        close: vi.fn().mockResolvedValue(undefined),
      };
    } as any);
    authenticateMock.mockResolvedValue(undefined);
    applyStorageStateMock.mockResolvedValue(undefined);
  });

  it("uses the configured headless mode when creating Stagehand", () => {
    createStagehand({
      models: { planner: "anthropic/claude-sonnet-4-6" },
      browser: { headless: true },
    } as any);

    expect(stagehandCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        localBrowserLaunchOptions: { headless: true },
      })
    );
  });

  it("reuses shared storage state for worker browsers instead of reauthenticating", async () => {
    const errorCollector = { attach: vi.fn() };
    const trafficObserver = { attach: vi.fn() };

    const pool = await initWorkerPool(
      {
        targetUrl: "https://example.com/app",
        models: { planner: "anthropic/claude-sonnet-4-6" },
        browser: { headless: false },
      } as any,
      2,
      errorCollector as any,
      trafficObserver as any,
      { cookies: [], origins: [] } as any
    );

    expect(pool).toHaveLength(2);
    expect(authenticateMock).not.toHaveBeenCalled();
    expect(applyStorageStateMock).toHaveBeenCalledTimes(2);
    expect(errorCollector.attach).toHaveBeenCalledTimes(2);
    expect(trafficObserver.attach).toHaveBeenCalledTimes(2);
  });

  it("falls back to full authenticate when no shared state is supplied", async () => {
    const errorCollector = { attach: vi.fn() };

    await initWorkerPool(
      {
        targetUrl: "https://example.com/app",
        models: { planner: "anthropic/claude-sonnet-4-6" },
        browser: { headless: false },
      } as any,
      1,
      errorCollector as any
    );

    expect(authenticateMock).toHaveBeenCalledTimes(1);
    expect(applyStorageStateMock).not.toHaveBeenCalled();
  });
});
