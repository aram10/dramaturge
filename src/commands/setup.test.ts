// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runSetup } from './setup.js';
import type { SetupDependencies, RepoScanResult } from './setup.js';
import type { RepoHints } from '../adaptation/types.js';

function makeHints(overrides: Partial<RepoHints> = {}): RepoHints {
  return {
    routes: [],
    routeFamilies: [],
    stableSelectors: [],
    apiEndpoints: [],
    authHints: { loginRoutes: [], callbackRoutes: [] },
    expectedHttpNoise: [],
    ...overrides,
  };
}

interface Harness {
  deps: SetupDependencies;
  messages: string[];
  errors: string[];
  promptQueue: string[];
  confirmQueue: boolean[];
  selectQueue: string[];
  promptCalls: string[];
  confirmCalls: Array<{ question: string; defaultValue?: boolean }>;
}

function makeHarness(
  cwd: string,
  queues: {
    prompts?: string[];
    confirms?: boolean[];
    selects?: string[];
    scan?: () => RepoScanResult;
  } = {}
): Harness {
  const messages: string[] = [];
  const errors: string[] = [];
  const promptQueue = queues.prompts ?? [];
  const confirmQueue = queues.confirms ?? [];
  const selectQueue = queues.selects ?? [];
  const promptCalls: string[] = [];
  const confirmCalls: Array<{ question: string; defaultValue?: boolean }> = [];

  const deps: SetupDependencies = {
    log: (msg) => messages.push(msg),
    error: (msg) => errors.push(msg),
    cwd,
    prompt: async (question) => {
      promptCalls.push(question);
      return promptQueue.shift() ?? '';
    },
    confirm: async (question, defaultValue) => {
      confirmCalls.push({ question, defaultValue });
      const next = confirmQueue.shift();
      return next ?? defaultValue ?? false;
    },
    select: async (_question, options) => {
      return selectQueue.shift() ?? options[0];
    },
    scanRepo: queues.scan,
  };
  return {
    deps,
    messages,
    errors,
    promptQueue,
    confirmQueue,
    selectQueue,
    promptCalls,
    confirmCalls,
  };
}

describe('runSetup', () => {
  let testDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-setup-'));
    // Prevent the wizard from prompting for an API key.
    savedEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      // ignore
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('skips repo scan when --no-scan equivalent is passed', async () => {
    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'Test app'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
      scan: () => {
        throw new Error('scanner should not run when repoPath is false');
      },
    });

    const code = await runSetup(h.deps, { repoPath: false });
    expect(code).toBe(0);

    const configPath = resolve(testDir, 'dramaturge.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.targetUrl).toBe('https://example.com');
    expect(config.repoContext).toBeUndefined();
    expect(config.apiTesting).toBeUndefined();
  });

  it('includes repoContext and suggested toggles when scan detects hints', async () => {
    const scan: RepoScanResult = {
      root: testDir,
      framework: 'nextjs',
      hints: makeHints({
        routes: ['/', '/dashboard', '/login'],
        apiEndpoints: [{ route: '/api/items', methods: ['GET', 'POST'], statuses: [200, 201] }],
        authHints: { loginRoutes: ['/login'], callbackRoutes: [] },
      }),
    };

    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'Next.js app'],
      confirms: [
        /* use detected hints */ true,
        /* requiresLogin (default true because login route detected) */ true,
        /* headless */ false,
        /* enable API testing */ true,
        /* enable adversarial */ false,
        /* saveConfig */ true,
      ],
      selects: ['Anthropic'],
      scan: () => scan,
    });

    const code = await runSetup(h.deps, { repoPath: testDir });
    expect(code).toBe(0);

    const configPath = resolve(testDir, 'dramaturge.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.repoContext).toEqual({ root: '.', framework: 'nextjs' });
    expect(config.apiTesting).toEqual({ enabled: true });
    expect(config.adversarial).toBeUndefined();
    expect(config.auth.type).toBe('interactive');
    expect(config.auth.loginUrl).toBe('https://example.com/login');
  });

  it('auto-detects a git repo in cwd and scans it', async () => {
    // Make testDir look like a git repo
    mkdirSync(resolve(testDir, '.git'));

    let scanned = false;
    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
      scan: () => {
        scanned = true;
        return { root: testDir, framework: 'generic', hints: makeHints() };
      },
    });

    const code = await runSetup(h.deps);
    expect(code).toBe(0);
    expect(scanned).toBe(true);
  });

  it('does not auto-scan when cwd is not a git repo', async () => {
    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
      scan: () => {
        throw new Error('scanner should not run without .git or --repo');
      },
    });

    const code = await runSetup(h.deps);
    expect(code).toBe(0);
  });

  it('rejects invalid target URLs', async () => {
    const h = makeHarness(testDir, {
      prompts: ['not a url'],
    });
    const code = await runSetup(h.deps, { repoPath: false });
    expect(code).toBe(1);
    expect(h.errors.some((e) => e.includes('Invalid URL'))).toBe(true);
  });

  it('reports an error when explicit --repo path does not exist', async () => {
    const missing = resolve(testDir, 'does-not-exist');
    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
    });

    const code = await runSetup(h.deps, { repoPath: missing });
    expect(code).toBe(0);
    expect(h.errors.some((e) => e.includes('Repo path not found'))).toBe(true);
    // Config is still written but without repoContext
    const config = JSON.parse(readFileSync(resolve(testDir, 'dramaturge.config.json'), 'utf8'));
    expect(config.repoContext).toBeUndefined();
  });

  it('skips repoContext when hints are empty even with successful scan', async () => {
    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
      scan: () => ({ root: testDir, framework: 'generic', hints: makeHints() }),
    });

    const code = await runSetup(h.deps, { repoPath: testDir });
    expect(code).toBe(0);
    const config = JSON.parse(readFileSync(resolve(testDir, 'dramaturge.config.json'), 'utf8'));
    expect(config.repoContext).toBeUndefined();
  });

  it('records repoContext when framework is detected but no hints were extracted', async () => {
    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
      scan: () => ({ root: testDir, framework: 'nextjs', hints: makeHints() }),
    });

    const code = await runSetup(h.deps, { repoPath: testDir });
    expect(code).toBe(0);
    const config = JSON.parse(readFileSync(resolve(testDir, 'dramaturge.config.json'), 'utf8'));
    expect(config.repoContext).toEqual({ root: '.', framework: 'nextjs' });
  });

  it('auto-detects git repo from a subdirectory by walking upward', async () => {
    mkdirSync(resolve(testDir, '.git'));
    const subDir = resolve(testDir, 'packages', 'web');
    mkdirSync(subDir, { recursive: true });

    let scannedRoot: string | undefined;
    const subHarness = makeHarness(subDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [/* requiresLogin */ false, /* headless */ false, /* saveConfig */ true],
      selects: ['Anthropic'],
      scan: (root) => {
        scannedRoot = root;
        return { root, framework: 'generic', hints: makeHints() };
      },
    });

    const code = await runSetup(subHarness.deps);
    expect(code).toBe(0);
    expect(scannedRoot).toBe(testDir);
  });

  it('does not overwrite existing config when user declines', async () => {
    const configPath = resolve(testDir, 'dramaturge.config.json');
    writeFileSync(configPath, '{"existing":true}\n');

    const h = makeHarness(testDir, {
      prompts: ['https://example.com', 'App'],
      confirms: [
        /* requiresLogin */ false,
        /* headless */ false,
        /* saveConfig */ true,
        /* overwrite */ false,
      ],
      selects: ['Anthropic'],
    });

    const code = await runSetup(h.deps, { repoPath: false });
    expect(code).toBe(0);
    expect(readFileSync(configPath, 'utf8')).toBe('{"existing":true}\n');
  });
});
