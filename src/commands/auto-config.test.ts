// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runAutoConfig } from './auto-config.js';
import type { AutoConfigDependencies, RepoScanResult } from './auto-config.js';
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
  deps: AutoConfigDependencies;
  messages: string[];
  errors: string[];
  promptCalls: string[];
  confirmCalls: Array<{ question: string; defaultValue?: boolean }>;
}

function makeHarness(
  cwd: string,
  queues: {
    prompts?: string[];
    confirms?: boolean[];
    selects?: string[];
    scan?: (root: string) => RepoScanResult;
    sendChatCompletion?: AutoConfigDependencies['sendChatCompletion'];
  } = {}
): Harness {
  const messages: string[] = [];
  const errors: string[] = [];
  const promptQueue = queues.prompts ?? [];
  const confirmQueue = queues.confirms ?? [];
  const selectQueue = queues.selects ?? [];
  const promptCalls: string[] = [];
  const confirmCalls: Array<{ question: string; defaultValue?: boolean }> = [];

  const deps: AutoConfigDependencies = {
    log: (message) => messages.push(message),
    error: (message) => errors.push(message),
    cwd,
    prompt: async (question) => {
      promptCalls.push(question);
      return promptQueue.shift() ?? '';
    },
    confirm: async (question, defaultValue) => {
      confirmCalls.push({ question, defaultValue });
      const answer = confirmQueue.shift();
      return answer ?? defaultValue ?? false;
    },
    select: async (_question, options) => selectQueue.shift() ?? options[0],
    scanRepo: queues.scan,
    sendChatCompletion: queues.sendChatCompletion,
  };

  return {
    deps,
    messages,
    errors,
    promptCalls,
    confirmCalls,
  };
}

describe('runAutoConfig', () => {
  let testDir: string;
  let savedEnv: Record<string, string | undefined>;
  const providerEnvKeys = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'AZURE_AI_API_KEY',
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN',
    'OLLAMA_HOST',
    'OPENAI_COMPATIBLE_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_PLANNER_MODEL',
    'OPENAI_COMPATIBLE_WORKER_MODEL',
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-auto-config-'));
    savedEnv = Object.fromEntries(providerEnvKeys.map((key) => [key, process.env[key]])) as Record<
      string,
      string | undefined
    >;
    for (const key of providerEnvKeys) {
      delete process.env[key];
    }
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      // ignore
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('writes a config using confident LLM inference', async () => {
    mkdirSync(resolve(testDir, '.git'));
    writeFileSync(
      resolve(testDir, 'package.json'),
      JSON.stringify({
        name: 'example-app',
        description: 'Example app',
        scripts: { dev: 'next dev' },
      })
    );
    writeFileSync(resolve(testDir, 'README.md'), '# Example app\n\nA dashboard app.\n');

    const scan: RepoScanResult = {
      root: testDir,
      framework: 'nextjs',
      hints: makeHints({
        routes: ['/', '/dashboard', '/login'],
        apiEndpoints: [{ route: '/api/items', methods: ['GET'], statuses: [200] }],
        authHints: { loginRoutes: ['/login'], callbackRoutes: [] },
      }),
    };

    const harness = makeHarness(testDir, {
      prompts: ['https://example.com'],
      confirms: [/* headless */ false],
      scan: () => scan,
      sendChatCompletion: vi.fn().mockResolvedValue(`{
        "appDescription": { "value": "Admin dashboard for managing items and users.", "confidence": "high" },
        "requiresLogin": { "value": true, "confidence": "high" },
        "loginPath": { "value": "/login", "confidence": "high" },
        "criticalFlows": { "value": ["View the dashboard", "Manage items"], "confidence": "high" },
        "focusModes": { "value": ["navigation", "crud", "api"], "confidence": "high" },
        "enableApiTesting": { "value": true, "confidence": "high" },
        "enableAdversarial": { "value": false, "confidence": "high" }
      }`),
    });

    const code = await runAutoConfig(harness.deps, {});
    expect(code).toBe(0);

    const config = JSON.parse(readFileSync(resolve(testDir, 'dramaturge.config.json'), 'utf8'));
    expect(config.appDescription).toBe('Admin dashboard for managing items and users.');
    expect(config.auth.type).toBe('interactive');
    expect(config.auth.loginUrl).toBe('https://example.com/login');
    expect(config.mission).toEqual({
      criticalFlows: ['View the dashboard', 'Manage items'],
      focusModes: ['navigation', 'crud', 'api'],
      destructiveActionsAllowed: false,
    });
    expect(config.apiTesting).toEqual({ enabled: true });
    expect(config.repoContext).toEqual({ root: '.', framework: 'nextjs' });
    expect(harness.promptCalls).toEqual(['What URL should I test?']);
  });

  it('falls back to prompts for uncertain fields', async () => {
    const scan: RepoScanResult = {
      root: testDir,
      framework: 'generic',
      hints: makeHints({
        authHints: { loginRoutes: ['/signin'], callbackRoutes: [] },
      }),
    };

    const harness = makeHarness(testDir, {
      prompts: [
        'https://example.com',
        'Customer portal for support tickets',
        '/signin',
        'Submit a support ticket, Review ticket history',
        'navigation,form',
      ],
      confirms: [/* requiresLogin */ true, /* enableApiTesting */ false, /* headless */ true],
      scan: () => scan,
      sendChatCompletion: vi.fn().mockResolvedValue(`{
        "requiresLogin": { "value": true, "confidence": "medium" },
        "loginPath": { "value": "/signin", "confidence": "medium" }
      }`),
    });

    const code = await runAutoConfig(harness.deps, {});
    expect(code).toBe(0);

    const config = JSON.parse(readFileSync(resolve(testDir, 'dramaturge.config.json'), 'utf8'));
    expect(config.appDescription).toBe('Customer portal for support tickets');
    expect(config.auth.loginUrl).toBe('https://example.com/signin');
    expect(config.mission).toEqual({
      criticalFlows: ['Submit a support ticket', 'Review ticket history'],
      focusModes: ['navigation', 'form'],
      destructiveActionsAllowed: false,
    });
    expect(config.browser.headless).toBe(true);
    expect(config.apiTesting).toBeUndefined();
    expect(
      harness.promptCalls.some((question) => question.includes('Critical flows to prioritize'))
    ).toBe(true);
  });

  it('reports an error when no provider API key is configured', async () => {
    for (const key of providerEnvKeys) {
      delete process.env[key];
    }
    const harness = makeHarness(testDir);

    const code = await runAutoConfig(harness.deps, {});
    expect(code).toBe(1);
    expect(harness.errors).toContain(
      'No LLM API key detected. Export a supported provider key before running auto-config.'
    );
  });

  it('supports custom output paths', async () => {
    const harness = makeHarness(testDir, {
      prompts: ['https://example.com', 'Example app', '', ''],
      confirms: [/* requiresLogin */ false, /* enableApiTesting */ false, /* headless */ false],
      sendChatCompletion: vi.fn().mockResolvedValue('{}'),
    });

    const code = await runAutoConfig(harness.deps, {
      repoPath: false,
      outputPath: './config/generated.json',
    });

    expect(code).toBe(0);
    const config = JSON.parse(readFileSync(resolve(testDir, 'config/generated.json'), 'utf8'));
    expect(config.targetUrl).toBe('https://example.com/');
  });
});
