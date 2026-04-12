// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { getChangedFiles, parseDiffNameStatus } from './diff-parser.js';

describe('parseDiffNameStatus', () => {
  it('parses added, modified, and deleted files', () => {
    const raw = [
      'A\tsrc/pages/dashboard/index.tsx',
      'M\tsrc/api/users.ts',
      'D\tsrc/old-component.tsx',
    ].join('\n');

    const entries = parseDiffNameStatus(raw);

    expect(entries).toEqual([
      { path: 'src/pages/dashboard/index.tsx', status: 'added' },
      { path: 'src/api/users.ts', status: 'modified' },
      { path: 'src/old-component.tsx', status: 'deleted' },
    ]);
  });

  it('parses renamed files using the new path', () => {
    const raw = 'R085\tsrc/old-name.ts\tsrc/new-name.ts';
    const entries = parseDiffNameStatus(raw);

    expect(entries).toEqual([{ path: 'src/new-name.ts', status: 'renamed' }]);
  });

  it('parses copied files as added', () => {
    const raw = 'C100\tsrc/original.ts\tsrc/copy.ts';
    const entries = parseDiffNameStatus(raw);

    expect(entries).toEqual([{ path: 'src/copy.ts', status: 'added' }]);
  });

  it('skips blank lines', () => {
    const raw = 'M\tsrc/file.ts\n\n\nA\tsrc/other.ts\n';
    const entries = parseDiffNameStatus(raw);

    expect(entries).toHaveLength(2);
  });

  it('returns empty for empty input', () => {
    expect(parseDiffNameStatus('')).toEqual([]);
    expect(parseDiffNameStatus('  \n  ')).toEqual([]);
  });

  it('skips malformed lines with no tab', () => {
    const raw = 'no-tab-here\nM\tvalid.ts';
    const entries = parseDiffNameStatus(raw);

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('valid.ts');
  });

  it('defaults unrecognized status letters to modified', () => {
    const raw = 'X\tsrc/unknown-status.ts';
    const entries = parseDiffNameStatus(raw);

    expect(entries).toEqual([{ path: 'src/unknown-status.ts', status: 'modified' }]);
  });
});

describe('getChangedFiles', () => {
  it('returns an empty array for invalid git ref', () => {
    const result = getChangedFiles('non-existent-ref-abc123', '/tmp');
    expect(result).toEqual([]);
  });
});
