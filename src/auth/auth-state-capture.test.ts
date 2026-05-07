// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Hoisted mock factories for Playwright
const mocks = vi.hoisted(() => {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://example.com/dashboard'),
    title: vi.fn().mockResolvedValue('Dashboard'),
    waitForURL: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  };

  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    storageState: vi.fn().mockResolvedValue(undefined),
  };

  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const chromium = {
    launch: vi.fn().mockResolvedValue(browser),
  };

  return { page, context, browser, chromium };
});

vi.mock('playwright', () => ({
  chromium: mocks.chromium,
}));

import {
  captureAuthStateViaUserConfirmation,
  captureAuthStateViaSuccessUrl,
} from './auth-state-capture.js';

function makeIo(
  overrides: Partial<Parameters<typeof captureAuthStateViaUserConfirmation>[1]> = {}
) {
  const logs: string[] = [];
  return {
    log: (msg: string) => logs.push(msg),
    error: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    confirm: vi.fn().mockResolvedValue(true),
    logs,
    ...overrides,
  };
}

describe('captureAuthStateViaUserConfirmation', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-auth-capture-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('saves storage state and returns confirmed=true when user confirms', async () => {
    const outputPath = resolve(testDir, 'state.json');
    const io = makeIo();

    const result = await captureAuthStateViaUserConfirmation(
      { loginUrl: 'https://example.com/login', outputPath },
      io
    );

    expect(result.confirmed).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(mocks.context.storageState).toHaveBeenCalledWith({ path: outputPath });
    expect(mocks.browser.close).toHaveBeenCalled();
  });

  it('creates the parent directory if it does not exist', async () => {
    const outputPath = resolve(testDir, 'nested', 'deep', 'state.json');
    const io = makeIo();

    await captureAuthStateViaUserConfirmation(
      { loginUrl: 'https://example.com/login', outputPath },
      io
    );

    expect(existsSync(resolve(testDir, 'nested', 'deep'))).toBe(true);
  });

  it('returns confirmed=false when user does not confirm and declines retry', async () => {
    const outputPath = resolve(testDir, 'state.json');
    const io = makeIo({
      confirm: vi
        .fn()
        .mockResolvedValueOnce(false) // Did login succeed? → no
        .mockResolvedValueOnce(false), // Keep trying? → no
    });

    const result = await captureAuthStateViaUserConfirmation(
      { loginUrl: 'https://example.com/login', outputPath },
      io
    );

    expect(result.confirmed).toBe(false);
    expect(mocks.context.storageState).not.toHaveBeenCalled();
    expect(mocks.browser.close).toHaveBeenCalled();
  });

  it('retries when user declines but agrees to retry, then confirms', async () => {
    const outputPath = resolve(testDir, 'state.json');
    const io = makeIo({
      confirm: vi
        .fn()
        .mockResolvedValueOnce(false) // Did login succeed? attempt 1 → no
        .mockResolvedValueOnce(true) // Keep trying? → yes
        .mockResolvedValueOnce(true), // Did login succeed? attempt 2 → yes
    });

    const result = await captureAuthStateViaUserConfirmation(
      { loginUrl: 'https://example.com/login', outputPath },
      io
    );

    expect(result.confirmed).toBe(true);
    expect(mocks.context.storageState).toHaveBeenCalledWith({ path: outputPath });
  });

  it('throws if prompt or confirm I/O is missing', async () => {
    const outputPath = resolve(testDir, 'state.json');
    const io = { log: vi.fn(), error: vi.fn() };

    await expect(
      captureAuthStateViaUserConfirmation({ loginUrl: 'https://example.com/login', outputPath }, io)
    ).rejects.toThrow('Auth capture requires interactive prompt/confirm I/O.');
  });
});

describe('captureAuthStateViaSuccessUrl', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-auth-success-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('saves storage state and returns timedOut=false on successful URL match', async () => {
    const outputPath = resolve(testDir, 'state.json');
    const io = makeIo();

    const result = await captureAuthStateViaSuccessUrl(
      {
        loginUrl: 'https://example.com/login',
        outputPath,
        successUrl: 'https://example.com/dashboard',
        timeoutMs: 30000,
      },
      io
    );

    expect(result.timedOut).toBe(false);
    expect(result.outputPath).toBe(outputPath);
    expect(mocks.context.storageState).toHaveBeenCalledWith({ path: outputPath });
    expect(mocks.browser.close).toHaveBeenCalled();
  });

  it('saves state and returns timedOut=true when waitForURL times out', async () => {
    mocks.page.waitForURL.mockRejectedValueOnce(new Error('Timeout'));

    const outputPath = resolve(testDir, 'state.json');
    const io = makeIo();

    const result = await captureAuthStateViaSuccessUrl(
      {
        loginUrl: 'https://example.com/login',
        outputPath,
        successUrl: 'https://example.com/dashboard',
        timeoutMs: 5000,
      },
      io
    );

    expect(result.timedOut).toBe(true);
    expect(mocks.context.storageState).toHaveBeenCalledWith({ path: outputPath });
    expect(mocks.browser.close).toHaveBeenCalled();
  });

  it('creates the parent directory when it does not exist', async () => {
    const outputPath = resolve(testDir, 'sub', 'state.json');
    const io = makeIo();

    await captureAuthStateViaSuccessUrl(
      {
        loginUrl: 'https://example.com/login',
        outputPath,
        successUrl: 'https://example.com/dashboard',
        timeoutMs: 5000,
      },
      io
    );

    expect(existsSync(resolve(testDir, 'sub'))).toBe(true);
  });
});
