// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInit } from './init.js';
import type { InitDependencies } from './init.js';

describe('runInit', () => {
  const tmpDir = resolve('/tmp/dramaturge-init-test');
  const configPath = resolve(tmpDir, 'dramaturge.config.json');

  function makeDeps(): InitDependencies & { messages: string[]; errors: string[] } {
    const messages: string[] = [];
    const errors: string[] = [];
    return {
      messages,
      errors,
      log: (msg) => messages.push(msg),
      error: (msg) => errors.push(msg),
      cwd: tmpDir,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(tmpDir, { recursive: true });
    try {
      unlinkSync(configPath);
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      unlinkSync(configPath);
    } catch {
      // ignore
    }
  });

  it('creates minimal config file', () => {
    const deps = makeDeps();
    const exitCode = runInit({ template: 'minimal' }, deps);

    expect(exitCode).toBe(0);
    expect(existsSync(configPath)).toBe(true);
    expect(deps.messages.some((m) => m.includes('minimal'))).toBe(true);

    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(content.targetUrl).toBe('https://your-app.example.com');
  });

  it('creates full config file', () => {
    const deps = makeDeps();
    const exitCode = runInit({ template: 'full' }, deps);

    expect(exitCode).toBe(0);
    expect(existsSync(configPath)).toBe(true);

    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(content.targetUrl).toBe('https://your-app.example.com');
    expect(content.mission).toBeDefined();
    expect(content.apiTesting).toBeDefined();
  });

  it('refuses to overwrite existing config', () => {
    writeFileSync(configPath, '{}');
    const deps = makeDeps();
    const exitCode = runInit({ template: 'minimal' }, deps);

    expect(exitCode).toBe(1);
    expect(deps.errors.some((m) => m.includes('already exists'))).toBe(true);
  });

  it('uses provided targetUrl', () => {
    const deps = makeDeps();
    runInit({ template: 'minimal', targetUrl: 'https://custom.example.com' }, deps);

    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(content.targetUrl).toBe('https://custom.example.com');
  });
});
