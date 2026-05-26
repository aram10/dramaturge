// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runDoctorChecks, printDoctorResults, runDoctor } from './doctor.js';
import type { DoctorCheckResult, DoctorDependencies } from './doctor.js';

describe('runDoctorChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an array of check results', () => {
    const results = runDoctorChecks(process.cwd());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const check of results) {
      expect(check).toHaveProperty('label');
      expect(check).toHaveProperty('ok');
      expect(check).toHaveProperty('message');
    }
  });

  it('includes Node.js version check', () => {
    const results = runDoctorChecks(process.cwd());
    const nodeCheck = results.find((r) => r.label === 'Node.js version');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.ok).toBe(true);
  });

  it('includes LLM API key check', () => {
    const results = runDoctorChecks(process.cwd());
    const apiCheck = results.find((r) => r.label === 'LLM API key');
    expect(apiCheck).toBeDefined();
  });

  it('includes config file check', () => {
    const results = runDoctorChecks(process.cwd());
    const configCheck = results.find((r) => r.label === 'Config file');
    expect(configCheck).toBeDefined();
  });

  it('includes output directory check', () => {
    const results = runDoctorChecks(process.cwd());
    const outputCheck = results.find((r) => r.label === 'Output directory');
    expect(outputCheck).toBeDefined();
    expect(outputCheck!.ok).toBe(true);
  });
});

describe('printDoctorResults', () => {
  it('prints results with check marks', () => {
    const messages: string[] = [];
    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
    };

    const results: DoctorCheckResult[] = [{ label: 'Test check', ok: true, message: 'All good' }];

    const allOk = printDoctorResults(results, deps);
    expect(allOk).toBe(true);
    expect(messages.some((m) => m.includes('✓'))).toBe(true);
    expect(messages.some((m) => m.includes('All checks passed'))).toBe(true);
  });

  it('prints failed checks with fix suggestions', () => {
    const messages: string[] = [];
    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
    };

    const results: DoctorCheckResult[] = [
      { label: 'Failed check', ok: false, message: 'Not found', fix: 'Run some command' },
    ];

    const allOk = printDoctorResults(results, deps);
    expect(allOk).toBe(false);
    expect(messages.some((m) => m.includes('✗'))).toBe(true);
    expect(messages.some((m) => m.includes('Fix:'))).toBe(true);
    expect(messages.some((m) => m.includes('Some checks failed'))).toBe(true);
  });
});

describe('runDoctor', () => {
  let originalPlaywrightBrowsersPath: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlaywrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  });

  afterEach(() => {
    if (originalPlaywrightBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = originalPlaywrightBrowsersPath;
    }
  });

  it('returns 0 or 1 based on checks', async () => {
    const messages: string[] = [];
    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
    };

    const exitCode = await runDoctor(deps);
    expect(typeof exitCode).toBe('number');
    expect(exitCode === 0 || exitCode === 1).toBe(true);
    expect(messages.some((m) => m.includes('Dramaturge Doctor'))).toBe(true);
  });

  it('prompts to install Chromium and runs install when confirmed', async () => {
    const originalCi = process.env.CI;
    delete process.env.CI;
    const browsersPath = mkdtempSync(resolve(tmpdir(), 'dramaturge-doctor-'));
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

    const messages: string[] = [];
    const confirms: string[] = [];
    const spawnCalls: Array<{ command: string; args: string[] }> = [];

    const spawnImpl = ((command: string, args: string[]): unknown => {
      spawnCalls.push({ command, args });
      const child = new EventEmitter();
      queueMicrotask(() => {
        mkdirSync(resolve(browsersPath, 'chromium-9999'), { recursive: true });
        child.emit('exit', 0);
      });
      return child;
    }) as unknown as DoctorDependencies['spawnImpl'];

    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
      confirm: async (question) => {
        confirms.push(question);
        return true;
      },
      spawnImpl,
      stdin: { isTTY: true } as unknown as NodeJS.ReadStream,
      stdout: { isTTY: true } as unknown as NodeJS.WriteStream,
    };

    try {
      await runDoctor(deps);
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
    }

    expect(confirms).toEqual(['Playwright Chromium is not installed. Install it now?']);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toEqual(['playwright', 'install', 'chromium']);
    expect(messages.some((m) => m.includes('Installing Playwright Chromium'))).toBe(true);
    expect(messages.some((m) => m.includes('Playwright Chromium') && m.includes('✓'))).toBe(true);
  });

  it('does not run install when user declines', async () => {
    const originalCi = process.env.CI;
    delete process.env.CI;
    const browsersPath = mkdtempSync(resolve(tmpdir(), 'dramaturge-doctor-'));
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

    const confirms: string[] = [];
    const spawnCalls: Array<{ command: string; args: string[] }> = [];

    const spawnImpl = ((command: string, args: string[]): unknown => {
      spawnCalls.push({ command, args });
      return new EventEmitter();
    }) as unknown as DoctorDependencies['spawnImpl'];

    try {
      await runDoctor({
        log: () => undefined,
        cwd: process.cwd(),
        confirm: async (question) => {
          confirms.push(question);
          return false;
        },
        spawnImpl,
        stdin: { isTTY: true } as unknown as NodeJS.ReadStream,
        stdout: { isTTY: true } as unknown as NodeJS.WriteStream,
      });
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
    }

    expect(confirms).toEqual(['Playwright Chromium is not installed. Install it now?']);
    expect(spawnCalls).toHaveLength(0);
  });

  it('does not prompt in non-interactive environments', async () => {
    const browsersPath = mkdtempSync(resolve(tmpdir(), 'dramaturge-doctor-'));
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

    const confirms: string[] = [];
    const spawnCalls: Array<{ command: string; args: string[] }> = [];

    const spawnImpl = ((command: string, args: string[]): unknown => {
      spawnCalls.push({ command, args });
      return new EventEmitter();
    }) as unknown as DoctorDependencies['spawnImpl'];

    await runDoctor({
      log: () => undefined,
      cwd: process.cwd(),
      confirm: async (question) => {
        confirms.push(question);
        return true;
      },
      spawnImpl,
      stdin: { isTTY: false } as unknown as NodeJS.ReadStream,
      stdout: { isTTY: false } as unknown as NodeJS.WriteStream,
    });

    expect(confirms).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
  });
});
