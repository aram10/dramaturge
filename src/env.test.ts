// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDotenv, loadDotenv } from './env.js';

describe('parseDotenv', () => {
  it('parses simple key=value pairs', () => {
    expect(parseDotenv('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores blank lines and comments', () => {
    const body = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
    `;
    expect(parseDotenv(body)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips optional export prefix', () => {
    expect(parseDotenv('export FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('handles double-quoted values', () => {
    expect(parseDotenv('FOO="hello world"')).toEqual({ FOO: 'hello world' });
  });

  it('handles single-quoted values', () => {
    expect(parseDotenv("FOO='hello world'")).toEqual({ FOO: 'hello world' });
  });

  it('strips inline comments on unquoted values', () => {
    expect(parseDotenv('FOO=bar # comment here')).toEqual({ FOO: 'bar' });
  });

  it('preserves hash inside quoted values', () => {
    expect(parseDotenv('FOO="bar # not a comment"')).toEqual({ FOO: 'bar # not a comment' });
  });

  it('skips lines without = sign', () => {
    expect(parseDotenv('INVALID_LINE\nFOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('handles value with equals sign', () => {
    expect(parseDotenv('FOO=bar=baz')).toEqual({ FOO: 'bar=baz' });
  });
});

describe('loadDotenv', () => {
  let testDir: string;
  const testKeys = ['DRAMATURGE_TEST_DOTENV_LOAD_KEY', 'DRAMATURGE_TEST_NO_OVERWRITE_KEY'];

  afterEach(() => {
    for (const key of testKeys) {
      delete process.env[key];
    }
    try {
      rmSync(testDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('returns 0 when .env does not exist', () => {
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-dotenv-'));
    const result = loadDotenv(join(testDir, 'nonexistent'));
    expect(result).toBe(0);
  });

  it('loads variables from an existing .env file', () => {
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-dotenv-'));
    const testKey = 'DRAMATURGE_TEST_DOTENV_LOAD_KEY';
    writeFileSync(join(testDir, '.env'), `${testKey}=test-value-123\n`);
    delete process.env[testKey];

    const result = loadDotenv(testDir);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(process.env[testKey]).toBe('test-value-123');
  });

  it('does not overwrite existing env vars', () => {
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-dotenv-'));
    const testKey = 'DRAMATURGE_TEST_NO_OVERWRITE_KEY';
    writeFileSync(join(testDir, '.env'), `${testKey}=new-value\n`);
    process.env[testKey] = 'original-value';

    loadDotenv(testDir);
    expect(process.env[testKey]).toBe('original-value');
  });
});
