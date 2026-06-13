// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomic-file.js';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-file-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes file contents and creates the parent directory', () => {
    const path = join(dir, 'nested', 'data.json');
    writeFileAtomic(path, '{"ok":true}');
    expect(readFileSync(path, 'utf-8')).toBe('{"ok":true}');
  });

  it('replaces existing contents without leaving temp files behind', () => {
    const path = join(dir, 'data.json');
    writeFileAtomic(path, 'first');
    writeFileAtomic(path, 'second');
    expect(readFileSync(path, 'utf-8')).toBe('second');
    const leftovers = readdirSync(dir).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
