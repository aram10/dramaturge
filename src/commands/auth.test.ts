// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runAuthCommand } from './auth.js';
import type { AuthCommandDependencies } from './auth.js';
import { ConfigSchema, type LoadedDramaturgeConfig } from '../config.js';

function makeDeps(
  cwd: string,
  overrides: Partial<AuthCommandDependencies> = {}
): AuthCommandDependencies {
  const messages: string[] = [];
  const errors: string[] = [];

  const deps: AuthCommandDependencies = {
    cwd,
    log: (msg) => messages.push(msg),
    error: (msg) => errors.push(msg),
    prompt: async () => '',
    confirm: async () => true,
    loadConfig: () => {
      throw new Error('loadConfig not implemented');
    },
    ...overrides,
  };

  return Object.assign(deps, { messages, errors });
}

function makeLoadedConfig(overrides: Partial<LoadedDramaturgeConfig> = {}): LoadedDramaturgeConfig {
  const config = ConfigSchema.parse({
    targetUrl: 'https://example.com',
    appDescription: 'app',
    auth: {
      type: 'interactive',
      loginUrl: 'https://example.com/login',
      successIndicator: 'url:https://example.com',
      stateFile: './.dramaturge-state/user.json',
    },
  });

  return {
    ...config,
    _meta: { configPath: resolve('/tmp/dramaturge.config.json'), configDir: resolve('/tmp') },
    ...overrides,
  };
}

describe('runAuthCommand', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-auth-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('lists saved auth profiles from .dramaturge-state', async () => {
    const stateDir = resolve(testDir, '.dramaturge-state');
    mkdirSync(stateDir);
    writeFileSync(resolve(stateDir, 'admin.json'), '{}');
    writeFileSync(resolve(stateDir, 'viewer.json'), '{}');

    const deps = makeDeps(testDir);
    const code = await runAuthCommand({ subcommand: 'list' }, deps);

    expect(code).toBe(0);
    // @ts-expect-error attached in test helper
    expect(deps.messages.join('\n')).toContain('Saved auth profiles:');
    // @ts-expect-error attached in test helper
    expect(deps.messages.join('\n')).toContain('admin');
    // @ts-expect-error attached in test helper
    expect(deps.messages.join('\n')).toContain('viewer');
  });

  it('captures auth state using the config loginUrl and profile name', async () => {
    const captureAuthState = vi
      .fn()
      .mockResolvedValue({ outputPath: '/tmp/state.json', confirmed: true });

    const deps = makeDeps(testDir, {
      loadConfig: () => makeLoadedConfig(),
      captureAuthState,
    });

    const code = await runAuthCommand({ subcommand: 'capture', profile: 'Admin' }, deps);
    expect(code).toBe(0);
    expect(captureAuthState).toHaveBeenCalledWith(
      {
        loginUrl: 'https://example.com/login',
        outputPath: resolve(testDir, '.dramaturge-state', 'admin.json'),
      },
      expect.objectContaining({
        log: expect.any(Function),
        error: expect.any(Function),
        prompt: expect.any(Function),
        confirm: expect.any(Function),
      })
    );
  });
});
