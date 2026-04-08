import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserSessionLike, StorageStatePage } from '../browser/page-interface.js';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateInteractive } from './interactive.js';
import { waitForSuccess } from './success-indicator.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-interactive-auth-'));
  tempDirs.push(dir);
  return dir;
}

function createMockStagehand() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (_fn?: unknown, items?: unknown) => {
      if (Array.isArray(items)) return undefined;
      return [{ name: 'theme', value: 'dark' }];
    }),
    locator: vi.fn(),
    url: vi.fn().mockReturnValue('https://example.com/app'),
  };

  const context = {
    addCookies: vi.fn().mockResolvedValue(undefined),
    cookies: vi.fn().mockResolvedValue([
      {
        name: 'session',
        value: 'fresh-cookie',
        domain: 'example.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]),
    pages: () => [page],
  };

  return {
    browser: { context } satisfies BrowserSessionLike<StorageStatePage>,
    page,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('authenticateInteractive', () => {
  it('restores cookies and matching-origin localStorage from cached state', async () => {
    const dir = createTempDir();
    const stateFile = join(dir, 'user.json');
    writeFileSync(
      stateFile,
      JSON.stringify({
        cookies: [
          {
            name: 'session',
            value: 'cached-cookie',
            domain: 'example.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          },
        ],
        origins: [
          {
            origin: 'https://example.com',
            localStorage: [{ name: 'theme', value: 'light' }],
          },
          {
            origin: 'https://other.example.com',
            localStorage: [{ name: 'ignored', value: 'true' }],
          },
        ],
      }),
      'utf-8'
    );

    const { browser, page } = createMockStagehand();

    await authenticateInteractive(
      browser,
      'https://example.com/app',
      '/login',
      "selector:[data-testid='app-shell']",
      stateFile
    );

    expect(browser.context.addCookies).toHaveBeenCalledWith([
      {
        name: 'session',
        value: 'cached-cookie',
        domain: 'example.com',
        path: '/',
        expires: undefined,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://example.com/app', {
      waitUntil: 'domcontentloaded',
    });
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), [
      { name: 'theme', value: 'light' },
    ]);
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://example.com/app', {
      waitUntil: 'domcontentloaded',
    });
    expect(waitForSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        goto: page.goto,
        evaluate: page.evaluate,
      }),
      "selector:[data-testid='app-shell']",
      10_000
    );
  });

  it('persists full storage state after manual login', async () => {
    const dir = createTempDir();
    const stateFile = join(dir, 'nested', 'user.json');
    const { browser, page } = createMockStagehand();

    await authenticateInteractive(
      browser,
      'https://example.com/app',
      '/login',
      "selector:[data-testid='app-shell']",
      stateFile,
      45_000
    );

    expect(page.goto).toHaveBeenCalledWith('https://example.com/login', {
      waitUntil: 'domcontentloaded',
    });
    expect(waitForSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        goto: page.goto,
        evaluate: page.evaluate,
      }),
      "selector:[data-testid='app-shell']",
      45_000
    );

    const saved = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(saved).toEqual({
      cookies: [
        {
          name: 'session',
          value: 'fresh-cookie',
          domain: 'example.com',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [{ name: 'theme', value: 'dark' }],
        },
      ],
    });
  });
});
