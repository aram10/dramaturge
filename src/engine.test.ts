import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BootstrapStatus = import('./engine/bootstrap.js').BootstrapStatus;

const bootstrapMocks = vi.hoisted(() => ({
  startBootstrapProcess: vi.fn(),
  stopBootstrapProcess: vi.fn(),
  waitForBootstrapReady: vi.fn(),
}));

const workerPoolMocks = vi.hoisted(() => ({
  createStagehand: vi.fn(),
  initWorkerPool: vi.fn(),
  closeWorkerPool: vi.fn(),
}));

vi.mock('./engine/bootstrap.js', () => ({
  startBootstrapProcess: bootstrapMocks.startBootstrapProcess,
  stopBootstrapProcess: bootstrapMocks.stopBootstrapProcess,
  waitForBootstrapReady: bootstrapMocks.waitForBootstrapReady,
}));

vi.mock('./engine/worker-pool.js', () => ({
  createStagehand: workerPoolMocks.createStagehand,
  initWorkerPool: workerPoolMocks.initWorkerPool,
  closeWorkerPool: workerPoolMocks.closeWorkerPool,
}));

vi.mock('./browser-errors.js', () => ({
  BrowserErrorCollector: class {
    attach(): void {}
    detach(): void {}
  },
}));

vi.mock('./network/traffic-observer.js', () => ({
  NetworkTrafficObserver: class {
    attach(): void {}
    detach(): void {}
  },
}));

const { runEngine } = await import('./engine.js');

describe('runEngine bootstrap readiness', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-engine-test-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes the bootstrap process status into readiness checks and cleans up on failure', async () => {
    const page = {};
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockReturnValue({});
    const stagehand = {
      init: vi.fn().mockResolvedValue(undefined),
      context: {
        pages: () => [page],
        newPage,
        close: closeContext,
      },
    };
    const bootstrapStatus: BootstrapStatus = {
      process: { pid: 1234 } as never,
      recentStdout: [],
      recentStderr: ['server crashed'],
      exited: true,
      exitCode: 1,
      exitSignal: null,
    };

    workerPoolMocks.createStagehand.mockReturnValue(stagehand as never);
    bootstrapMocks.startBootstrapProcess.mockReturnValue(bootstrapStatus);
    bootstrapMocks.waitForBootstrapReady.mockRejectedValue(
      new Error('Bootstrap process exited before ready')
    );

    const config = {
      targetUrl: 'https://example.com',
      output: { dir: join(tempDir, 'output') },
      budget: {},
      exploration: {
        totalTimeout: 60,
        stepsPerArea: 5,
      },
      concurrency: {
        workers: 1,
      },
      models: {
        planner: 'claude-3-5-sonnet',
      },
      apiTesting: {
        enabled: false,
      },
      adversarial: {
        enabled: false,
      },
      diffAware: {
        enabled: false,
        baseRef: undefined,
        priorityBoost: 0,
      },
      memory: {
        enabled: false,
        dir: join(tempDir, 'memory'),
        warmStart: false,
      },
      autoCapture: {
        consoleErrors: false,
        consoleWarnings: false,
        networkErrors: false,
        networkErrorMinStatus: 500,
      },
      auth: {
        type: 'none',
      },
      policy: {},
    } as never;

    await expect(runEngine(config)).rejects.toThrow('Bootstrap process exited before ready');

    expect(bootstrapMocks.waitForBootstrapReady).toHaveBeenCalledWith(
      config,
      page,
      bootstrapStatus,
      expect.objectContaining({ newPage: expect.any(Function) })
    );
    const readinessOptions = bootstrapMocks.waitForBootstrapReady.mock.calls[0]?.[3] as {
      newPage: () => void;
    };
    readinessOptions.newPage();
    expect(newPage).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalled();
    expect(bootstrapMocks.stopBootstrapProcess).toHaveBeenCalledWith(bootstrapStatus);
  });
});
