// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approveBaselines, listBaselineFiles } from './visual-baselines.js';

describe('visual-baselines', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dramaturge-baselines-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty array when directory does not exist', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(listBaselineFiles(dir)).toEqual([]);
  });

  it('lists baseline files and parses fingerprint/dimensions from filename', () => {
    writeFileSync(join(dir, 'abc123-1280x720.png'), 'fake');
    writeFileSync(join(dir, 'deadbeef-800x600.png'), 'fake');
    writeFileSync(join(dir, 'ignored.txt'), 'not a png');

    const files = listBaselineFiles(dir);
    expect(files).toHaveLength(2);
    expect(files[0].fingerprintHash).toBe('abc123');
    expect(files[0].width).toBe(1280);
    expect(files[0].height).toBe(720);
    expect(files[1].fingerprintHash).toBe('deadbeef');
  });

  it('handles files that do not match the naming pattern gracefully', () => {
    writeFileSync(join(dir, 'noversion.png'), 'fake');
    const files = listBaselineFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].fingerprintHash).toBe('noversion');
    expect(files[0].width).toBeUndefined();
    expect(files[0].height).toBeUndefined();
  });

  it('removes all baselines when target is "all"', () => {
    writeFileSync(join(dir, 'a-100x200.png'), 'fake');
    writeFileSync(join(dir, 'b-100x200.png'), 'fake');
    const result = approveBaselines(dir, 'all');
    expect(result.removed).toHaveLength(2);
    expect(result.notFound).toEqual([]);
    expect(listBaselineFiles(dir)).toEqual([]);
  });

  it('removes only baselines matching provided fingerprint identifiers', () => {
    writeFileSync(join(dir, 'keep-100x200.png'), 'fake');
    writeFileSync(join(dir, 'remove-100x200.png'), 'fake');
    const result = approveBaselines(dir, ['remove']);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].fingerprintHash).toBe('remove');
    expect(result.notFound).toEqual([]);
    expect(existsSync(join(dir, 'keep-100x200.png'))).toBe(true);
    expect(existsSync(join(dir, 'remove-100x200.png'))).toBe(false);
  });

  it('records unknown identifiers in notFound', () => {
    writeFileSync(join(dir, 'abc-100x200.png'), 'fake');
    const result = approveBaselines(dir, ['abc', 'nonexistent']);
    expect(result.removed).toHaveLength(1);
    expect(result.notFound).toEqual(['nonexistent']);
  });

  it('matches by full filename as well as fingerprint', () => {
    writeFileSync(join(dir, 'abc-100x200.png'), 'fake');
    const result = approveBaselines(dir, ['abc-100x200.png']);
    expect(result.removed).toHaveLength(1);
    expect(result.notFound).toEqual([]);
  });
});
