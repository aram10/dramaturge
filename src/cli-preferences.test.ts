// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getCliPreferencesPath,
  loadCliPreferences,
  saveCliPreferences,
} from './cli-preferences.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-cli-preferences-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('CLI preferences', () => {
  it('uses the documented path beneath the home directory', () => {
    expect(getCliPreferencesPath('C:/Users/tester')).toBe(
      join('C:/Users/tester', '.dramaturge', 'cli-config.json')
    );
  });

  it('returns empty versioned preferences when the file is absent or invalid', () => {
    const dir = createTempDir();
    const path = join(dir, 'cli-config.json');
    expect(loadCliPreferences(path)).toEqual({ version: 1 });
    writeFileSync(path, '{invalid', 'utf-8');
    expect(loadCliPreferences(path)).toEqual({ version: 1 });
  });

  it('round-trips only schema-approved non-secret preferences', () => {
    const dir = createTempDir();
    const path = join(dir, 'nested', 'cli-config.json');
    saveCliPreferences(
      {
        provider: 'openai',
        preset: 'smoke',
        focusModes: ['navigation', 'api'],
        formats: ['markdown', 'sarif'],
        headless: true,
        scopeMode: 'diff',
        diffBase: 'origin/main',
        failOnSeverity: 'major',
      },
      path
    );

    expect(loadCliPreferences(path)).toMatchObject({
      version: 1,
      provider: 'openai',
      preset: 'smoke',
      scopeMode: 'diff',
      failOnSeverity: 'major',
    });
    expect(readFileSync(path, 'utf-8')).not.toContain('API_KEY');
  });

  it('rejects unknown fields instead of persisting arbitrary data', () => {
    const dir = createTempDir();
    const path = join(dir, 'cli-config.json');
    expect(() =>
      saveCliPreferences({ targetUrl: 'https://private.example.com' } as never, path)
    ).toThrow();
  });
});
