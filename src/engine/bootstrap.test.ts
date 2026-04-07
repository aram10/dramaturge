import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startBootstrapProcess, stopBootstrapProcess, waitForBootstrapReady } from './bootstrap.js';

function createMockProcess() {
  const processRef = new EventEmitter() as any;
  processRef.pid = 4321;
  processRef.stdout = new PassThrough();
  processRef.stderr = new PassThrough();
  processRef.kill = vi.fn();
  return processRef;
}

function createResponse(status: number, ok = status >= 200 && status < 300) {
  return {
    status,
    ok,
  };
}

describe('bootstrap supervision', () => {
  it('fails fast when the bootstrap process exits before the app is ready', async () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn().mockReturnValue(processRef);

    const status = startBootstrapProcess(
      {
        bootstrap: {
          command: 'pnpm dev',
          cwd: 'C:/tmp/app',
        },
      } as any,
      spawnImpl as any
    )!;

    processRef.stderr.write('server crashed\n');
    processRef.emit('exit', 1, null);

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: 'https://example.com',
          bootstrap: {
            command: 'pnpm dev',
            readyUrl: '/health',
            timeoutSeconds: 5,
          },
        } as any,
        {
          goto: vi.fn(),
          evaluate: vi.fn(),
        } as any,
        status,
        {
          fetchImpl: vi.fn().mockResolvedValue(createResponse(503, false)) as any,
          sleep: async () => {},
          now: () => 0,
        }
      )
    ).rejects.toThrow(/Bootstrap process exited before ready/);

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: 'https://example.com',
          bootstrap: {
            command: 'pnpm dev',
            readyUrl: '/health',
            timeoutSeconds: 5,
          },
        } as any,
        {
          goto: vi.fn(),
          evaluate: vi.fn(),
        } as any,
        status,
        {
          fetchImpl: vi.fn().mockResolvedValue(createResponse(503, false)) as any,
          sleep: async () => {},
          now: () => 0,
        }
      )
    ).rejects.toThrow(/server crashed/);
  });

  it('times out a hanging ready-url fetch instead of waiting forever', async () => {
    let nowMs = 0;

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: 'https://example.com',
          bootstrap: {
            readyUrl: '/health',
            timeoutSeconds: 1,
          },
        } as any,
        {
          goto: vi.fn(),
          evaluate: vi.fn(),
        } as any,
        undefined,
        {
          requestTimeoutMs: 5,
          fetchImpl: vi.fn(
            (_url: string, init?: RequestInit) =>
              new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                  reject(new Error('aborted'));
                });
              })
          ) as any,
          sleep: async () => {
            nowMs += 1000;
          },
          now: () => nowMs,
        }
      )
    ).rejects.toThrow(/did not become ready within 1s/);
  });

  it('checks DOM readiness on the app target page even when a health endpoint is configured', async () => {
    let nowMs = 0;
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(false),
    };

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: 'https://example.com',
          bootstrap: {
            readyUrl: '/health',
            readyIndicator: '#app-ready',
            timeoutSeconds: 1,
          },
        } as any,
        page as any,
        undefined,
        {
          fetchImpl: vi.fn().mockResolvedValue(createResponse(200, true)) as any,
          sleep: async () => {
            nowMs += 1000;
          },
          now: () => nowMs,
        }
      )
    ).rejects.toThrow(/did not become ready within 1s/);

    expect(page.goto).toHaveBeenCalledWith('https://example.com');
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('starts bootstrap commands in a separate process group on Unix', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn().mockReturnValue(processRef);

    startBootstrapProcess(
      {
        bootstrap: {
          command: 'pnpm dev',
          cwd: '/tmp/app',
        },
      } as any,
      spawnImpl as any
    );

    expect(spawnImpl).toHaveBeenCalledWith('pnpm dev', {
      cwd: '/tmp/app',
      detached: process.platform !== 'win32',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('uses taskkill on Windows and terminates the process group on Unix during cleanup', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    stopBootstrapProcess({ process: processRef } as any, spawnImpl as any, 'win32');
    expect(spawnImpl).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/t', '/f'], {
      stdio: 'ignore',
    });

    stopBootstrapProcess({ process: processRef } as any, spawnImpl as any, 'linux');
    expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(processRef.kill).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it('falls back to killing the shell process when process-group termination fails', () => {
    const processRef = createMockProcess();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no such process group');
    });

    stopBootstrapProcess({ process: processRef } as any, vi.fn() as any, 'linux');

    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
    killSpy.mockRestore();
  });
});
