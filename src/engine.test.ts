import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runEngine } from './engine.js';
import {
  startBootstrapProcess,
  waitForBootstrapReady,
  type BootstrapStatus,
} from './engine/bootstrap.js';
import { createStagehand } from './engine/worker-pool.js';

vi.mock('./engine/bootstrap.js', () => ({
  startBootstrapProcess: vi.fn(),
  stopBootstrapProcess: vi.fn(),
  waitForBootstrapReady: vi.fn(),
}));

vi.mock('./engine/worker-pool.js', () => ({
  createStagehand: vi.fn(),
  initWorkerPool: vi.fn(),
  closeWorkerPool: vi.fn(),
}));

vi.mock('./browser-errors.js', () => ({
  BrowserErrorCollector: class {
    attach(): void {}
  },
}));

vi.mock('./network/traffic-observer.js', () => ({
  NetworkTrafficObserver: class {
    attach(): void {}
  },
}));

describe('runEngine bootstrap readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the bootstrap process status into readiness checks', async () => {
    const page = {};
    const stagehand = {
      init: vi.fn().mockResolvedValue(undefined),
      context: {
        pages: () => [page],
      },
    };
    const bootstrapStatus: BootstrapStatus = {
      process: { pid: 1234 } as never,
      stdout: '',
      stderr: 'server crashed',
      exited: true,
      exitCode: 1,
      signal: null,
    };

    vi.mocked(createStagehand).mockReturnValue(stagehand as never);
    vi.mocked(startBootstrapProcess).mockReturnValue(bootstrapStatus);
    vi.mocked(waitForBootstrapReady).mockRejectedValue(
      new Error('Bootstrap process exited before ready')
    );

    const config = {
      targetUrl: 'https://example.com',
      output: { dir: '/tmp/dramaturge-engine-test-output' },
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
        dir: '/tmp/dramaturge-memory-test',
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

    expect(waitForBootstrapReady).toHaveBeenCalledWith(config, page, bootstrapStatus);
  });
});
