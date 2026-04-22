// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

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

  it('checks DOM readiness on an isolated page even when a health endpoint is configured', async () => {
    let nowMs = 0;
    const readinessPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const newPage = vi.fn().mockResolvedValue(readinessPage);
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn(),
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
          newPage,
          sleep: async () => {
            nowMs += 1000;
          },
          now: () => nowMs,
        }
      )
    ).rejects.toThrow(/did not become ready within 1s/);

    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(newPage).toHaveBeenCalled();
    expect(readinessPage.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeoutMs: 1000,
    });
    expect(readinessPage.evaluate).toHaveBeenCalled();
    expect(readinessPage.close).toHaveBeenCalled();
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
      spawnImpl as any,
      'linux'
    );

    expect(spawnImpl).toHaveBeenCalledWith('pnpm dev', {
      cwd: '/tmp/app',
      detached: true,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('does not detach bootstrap commands on Windows', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn().mockReturnValue(processRef);

    startBootstrapProcess(
      {
        bootstrap: {
          command: 'pnpm dev',
          cwd: 'C:/tmp/app',
        },
      } as any,
      spawnImpl as any,
      'win32'
    );

    expect(spawnImpl).toHaveBeenCalledWith('pnpm dev', {
      cwd: 'C:/tmp/app',
      detached: false,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('uses taskkill on Windows during cleanup without attempting a process-group kill', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    stopBootstrapProcess({ process: processRef } as any, spawnImpl as any, 'win32');
    expect(spawnImpl).toHaveBeenCalledWith('taskkill', ['/pid', '4321', '/t', '/f'], {
      stdio: 'ignore',
    });
    expect(killSpy).not.toHaveBeenCalled();
    expect(processRef.kill).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it('terminates the process group on Unix during cleanup', () => {
    const processRef = createMockProcess();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    stopBootstrapProcess({ process: processRef } as any, vi.fn() as any, 'linux');
    expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(processRef.kill).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it('spawns safe-mode bootstrap commands without a shell and with structured args', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn().mockReturnValue(processRef);

    startBootstrapProcess(
      {
        bootstrap: {
          mode: 'safe',
          command: 'pnpm',
          args: ['dev', '--port', '3000'],
          cwd: '/tmp/app',
        },
      } as any,
      spawnImpl as any,
      'linux'
    );

    expect(spawnImpl).toHaveBeenCalledWith('pnpm', ['dev', '--port', '3000'], {
      cwd: '/tmp/app',
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('defaults to trusted mode and continues to spawn via the shell', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn().mockReturnValue(processRef);

    startBootstrapProcess(
      {
        bootstrap: {
          command: 'pnpm dev && tail -f log',
          cwd: '/tmp/app',
        },
      } as any,
      spawnImpl as any,
      'linux'
    );

    expect(spawnImpl).toHaveBeenCalledWith('pnpm dev && tail -f log', {
      cwd: '/tmp/app',
      detached: true,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('does not attempt cleanup after the bootstrap process has already exited', () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    stopBootstrapProcess({ exited: true, process: processRef } as any, spawnImpl as any, 'linux');

    expect(killSpy).not.toHaveBeenCalled();
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(processRef.kill).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('falls back to killing the shell process when process-group termination fails', () => {
    const processRef = createMockProcess();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('no such process group') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });

    stopBootstrapProcess({ process: processRef } as any, vi.fn() as any, 'linux');

    expect(processRef.kill).toHaveBeenCalledWith('SIGTERM');
    killSpy.mockRestore();
  });

  it('rethrows unexpected Unix process-group termination errors', () => {
    const processRef = createMockProcess();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('permission denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });

    expect(() =>
      stopBootstrapProcess({ process: processRef } as any, vi.fn() as any, 'linux')
    ).toThrow(/permission denied/);
    expect(processRef.kill).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});
