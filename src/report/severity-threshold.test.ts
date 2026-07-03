// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeMaxSeverity,
  findLatestReportDir,
  parseSeverityThreshold,
  readReportJson,
  severityMeetsThreshold,
} from './severity-threshold.js';

describe('severity-threshold', () => {
  describe('parseSeverityThreshold', () => {
    it('parses valid severity names case-insensitively', () => {
      expect(parseSeverityThreshold('major')).toBe('Major');
      expect(parseSeverityThreshold('CRITICAL')).toBe('Critical');
    });

    it('accepts a trailing "+" for compatibility with confirm-style filters', () => {
      expect(parseSeverityThreshold('major+')).toBe('Major');
    });

    it('throws on an invalid severity', () => {
      expect(() => parseSeverityThreshold('extreme')).toThrow('Invalid severity');
    });
  });

  describe('computeMaxSeverity', () => {
    it('returns undefined when there are no findings', () => {
      expect(computeMaxSeverity({})).toBeUndefined();
      expect(computeMaxSeverity({ findings: [] })).toBeUndefined();
    });

    it('uses summary.bySeverity when present', () => {
      expect(
        computeMaxSeverity({
          summary: { bySeverity: { Critical: 0, Major: 2, Minor: 0, Trivial: 1 } },
        })
      ).toBe('Major');
    });

    it('falls back to scanning findings when summary is absent', () => {
      expect(
        computeMaxSeverity({
          findings: [{ severity: 'Minor' }, { severity: 'Critical' }, { severity: 'Trivial' }],
        })
      ).toBe('Critical');
    });
  });

  describe('severityMeetsThreshold', () => {
    it('returns false when there are no findings', () => {
      expect(severityMeetsThreshold(undefined, 'Trivial')).toBe(false);
    });

    it('returns true when max severity meets the threshold', () => {
      expect(severityMeetsThreshold('Major', 'Major')).toBe(true);
    });

    it('returns true when max severity exceeds the threshold', () => {
      expect(severityMeetsThreshold('Critical', 'Major')).toBe(true);
    });

    it('returns false when max severity is below the threshold', () => {
      expect(severityMeetsThreshold('Minor', 'Major')).toBe(false);
    });
  });

  describe('findLatestReportDir / readReportJson', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-severity-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns undefined when the base dir does not exist', () => {
      expect(findLatestReportDir(join(tempDir, 'missing'))).toBeUndefined();
    });

    it('finds the most recently modified run dir containing report.json', () => {
      const older = join(tempDir, '2026-01-01T00-00-00');
      const newer = join(tempDir, '2026-01-02T00-00-00');
      mkdirSync(older, { recursive: true });
      mkdirSync(newer, { recursive: true });
      writeFileSync(join(older, 'report.json'), '{}', 'utf-8');
      writeFileSync(join(newer, 'report.json'), '{}', 'utf-8');
      const now = Date.now() / 1000;
      utimesSync(older, now - 60, now - 60);
      utimesSync(newer, now, now);

      expect(findLatestReportDir(tempDir)).toBe(newer);
    });

    it('ignores directories without report.json', () => {
      const noReport = join(tempDir, 'no-report');
      mkdirSync(noReport, { recursive: true });

      expect(findLatestReportDir(tempDir)).toBeUndefined();
    });

    it('reads and parses report.json', () => {
      writeFileSync(
        join(tempDir, 'report.json'),
        JSON.stringify({ summary: { bySeverity: { Critical: 1 } } }),
        'utf-8'
      );

      expect(readReportJson(tempDir)).toEqual({ summary: { bySeverity: { Critical: 1 } } });
    });

    it('returns undefined when report.json is missing', () => {
      expect(readReportJson(tempDir)).toBeUndefined();
    });

    it('returns undefined when report.json is invalid', () => {
      writeFileSync(join(tempDir, 'report.json'), 'not json', 'utf-8');
      expect(readReportJson(tempDir)).toBeUndefined();
    });
  });
});
