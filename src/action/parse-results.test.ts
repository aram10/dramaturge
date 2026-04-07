import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findLatestReportDir,
  parseReport,
  buildSummary,
  formatDuration,
  checkSeverityThreshold,
} from '../../action/parse-results.js';

describe('parse-results', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-action-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // findLatestReportDir
  // ---------------------------------------------------------------------------

  describe('findLatestReportDir', () => {
    it('returns null for non-existent directory', () => {
      expect(findLatestReportDir(join(tempDir, 'nope'))).toBeNull();
    });

    it('returns null for empty directory', () => {
      expect(findLatestReportDir(tempDir)).toBeNull();
    });

    it('returns null when subdirectories have no report.json', () => {
      mkdirSync(join(tempDir, '2024-01-01T00-00-00'));
      expect(findLatestReportDir(tempDir)).toBeNull();
    });

    it('finds the only report directory', () => {
      const dir = join(tempDir, '2024-01-01T00-00-00');
      mkdirSync(dir);
      writeFileSync(join(dir, 'report.json'), '{}');
      expect(findLatestReportDir(tempDir)).toBe(dir);
    });

    it('picks the latest directory when multiple exist', () => {
      const older = join(tempDir, '2024-01-01T00-00-00');
      const newer = join(tempDir, '2024-01-02T00-00-00');
      mkdirSync(older);
      mkdirSync(newer);
      writeFileSync(join(older, 'report.json'), '{}');
      writeFileSync(join(newer, 'report.json'), '{}');
      expect(findLatestReportDir(tempDir)).toBe(newer);
    });

    it('skips directories without report.json', () => {
      const older = join(tempDir, '2024-01-01T00-00-00');
      const newer = join(tempDir, '2024-01-02T00-00-00');
      mkdirSync(older);
      mkdirSync(newer);
      writeFileSync(join(older, 'report.json'), '{}');
      // newer has no report.json
      expect(findLatestReportDir(tempDir)).toBe(older);
    });
  });

  // ---------------------------------------------------------------------------
  // parseReport
  // ---------------------------------------------------------------------------

  describe('parseReport', () => {
    it('parses a valid JSON report', () => {
      const reportPath = join(tempDir, 'report.json');
      const data = { meta: { targetUrl: 'https://test.com' }, findings: [] };
      writeFileSync(reportPath, JSON.stringify(data));

      const result = parseReport(reportPath);
      expect(result.meta.targetUrl).toBe('https://test.com');
      expect(result.findings).toEqual([]);
    });

    it('parses a report with findings', () => {
      const reportPath = join(tempDir, 'report.json');
      const data = {
        findings: [{ id: 'BUG-001', severity: 'Critical', title: 'Crash' }],
      };
      writeFileSync(reportPath, JSON.stringify(data));

      const result = parseReport(reportPath);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].id).toBe('BUG-001');
    });
  });

  // ---------------------------------------------------------------------------
  // formatDuration
  // ---------------------------------------------------------------------------

  describe('formatDuration', () => {
    it('formats zero milliseconds', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('formats seconds only', () => {
      expect(formatDuration(5000)).toBe('5s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('formats exact minutes', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
    });

    it('rounds down sub-second values', () => {
      expect(formatDuration(1999)).toBe('1s');
    });
  });

  // ---------------------------------------------------------------------------
  // buildSummary
  // ---------------------------------------------------------------------------

  describe('buildSummary', () => {
    it('handles empty report', () => {
      const result = buildSummary({ meta: {}, summary: {}, findings: [] });
      expect(result.totalFindings).toBe(0);
      expect(result.maxSeverity).toBe('none');
      expect(result.markdown).toContain('No findings');
    });

    it('handles minimal report with no summary block', () => {
      const result = buildSummary({ findings: [] });
      expect(result.totalFindings).toBe(0);
      expect(result.maxSeverity).toBe('none');
    });

    it('generates summary with findings', () => {
      const report = {
        meta: { targetUrl: 'https://example.com', durationMs: 60000 },
        summary: {
          areasExplored: 5,
          totalSteps: 100,
          totalFindings: 3,
          bySeverity: { Critical: 1, Major: 1, Minor: 1, Trivial: 0 },
        },
        findings: [
          { id: 'BUG-001', severity: 'Critical', title: 'Form crashes' },
          { id: 'BUG-002', severity: 'Major', title: 'Broken link' },
          { id: 'UX-001', severity: 'Minor', title: 'Missing label' },
        ],
      };

      const result = buildSummary(report);
      expect(result.totalFindings).toBe(3);
      expect(result.maxSeverity).toBe('Critical');
      expect(result.markdown).toContain('https://example.com');
      expect(result.markdown).toContain('1m 0s');
      expect(result.markdown).toContain('3 findings');
      expect(result.markdown).toContain('BUG-001');
      expect(result.markdown).toContain('Form crashes');
    });

    it('identifies max severity as Major when no Critical', () => {
      const report = {
        meta: {},
        summary: {
          totalFindings: 2,
          bySeverity: { Critical: 0, Major: 2, Minor: 0, Trivial: 0 },
        },
        findings: [
          { id: 'BUG-001', severity: 'Major', title: 'Bug A' },
          { id: 'BUG-002', severity: 'Major', title: 'Bug B' },
        ],
      };
      expect(buildSummary(report).maxSeverity).toBe('Major');
    });

    it('identifies max severity as Trivial when only trivial', () => {
      const report = {
        meta: {},
        summary: {
          totalFindings: 1,
          bySeverity: { Critical: 0, Major: 0, Minor: 0, Trivial: 1 },
        },
        findings: [{ id: 'UX-001', severity: 'Trivial', title: 'Nit' }],
      };
      expect(buildSummary(report).maxSeverity).toBe('Trivial');
    });

    it('limits top findings to 10', () => {
      const findings = Array.from({ length: 15 }, (_, i) => ({
        id: `BUG-${String(i + 1).padStart(3, '0')}`,
        severity: 'Minor',
        title: `Issue ${i + 1}`,
      }));
      const report = {
        meta: {},
        summary: {
          totalFindings: 15,
          bySeverity: { Critical: 0, Major: 0, Minor: 15, Trivial: 0 },
        },
        findings,
      };

      const result = buildSummary(report);
      // Should mention BUG-010 but not BUG-011
      expect(result.markdown).toContain('BUG-010');
      expect(result.markdown).not.toContain('BUG-011');
    });

    it('includes area exploration footer', () => {
      const report = {
        meta: {},
        summary: { areasExplored: 8, totalSteps: 200, totalFindings: 0 },
        findings: [],
      };
      const result = buildSummary(report);
      expect(result.markdown).toContain('Explored 8 areas');
      expect(result.markdown).toContain('200 steps');
    });

    it("uses singular 'finding' for count of 1", () => {
      const report = {
        meta: {},
        summary: {
          totalFindings: 1,
          bySeverity: { Critical: 1, Major: 0, Minor: 0, Trivial: 0 },
        },
        findings: [{ id: 'BUG-001', severity: 'Critical', title: 'Crash' }],
      };
      const result = buildSummary(report);
      expect(result.markdown).toContain('1 finding\n');
      expect(result.markdown).not.toContain('1 findings');
    });

    it('falls back to findings array length when totalFindings missing', () => {
      const report = {
        meta: {},
        summary: {},
        findings: [
          { id: 'BUG-001', severity: 'Critical', title: 'A' },
          { id: 'BUG-002', severity: 'Major', title: 'B' },
        ],
      };
      expect(buildSummary(report).totalFindings).toBe(2);
    });

    it('computes severity summary from findings when bySeverity is missing', () => {
      const report = {
        meta: {},
        summary: {
          totalFindings: 3,
        },
        findings: [
          { id: 'BUG-001', severity: 'Critical', title: 'A' },
          { id: 'BUG-002', severity: 'Major', title: 'B' },
          { id: 'BUG-003', severity: 'Minor', title: 'C' },
        ],
      };

      const result = buildSummary(report);
      expect(result.maxSeverity).toBe('Critical');
      expect(result.bySeverity).toEqual({
        Critical: 1,
        Major: 1,
        Minor: 1,
        Trivial: 0,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // checkSeverityThreshold
  // ---------------------------------------------------------------------------

  describe('checkSeverityThreshold', () => {
    it('returns false when threshold is empty', () => {
      expect(checkSeverityThreshold('Critical', '')).toBe(false);
    });

    it('returns false when max severity is none', () => {
      expect(checkSeverityThreshold('none', 'critical')).toBe(false);
    });

    it('returns true when max severity equals threshold', () => {
      expect(checkSeverityThreshold('Critical', 'critical')).toBe(true);
      expect(checkSeverityThreshold('Major', 'major')).toBe(true);
      expect(checkSeverityThreshold('Minor', 'minor')).toBe(true);
      expect(checkSeverityThreshold('Trivial', 'trivial')).toBe(true);
    });

    it('returns true when max severity exceeds threshold', () => {
      expect(checkSeverityThreshold('Critical', 'major')).toBe(true);
      expect(checkSeverityThreshold('Critical', 'minor')).toBe(true);
      expect(checkSeverityThreshold('Critical', 'trivial')).toBe(true);
      expect(checkSeverityThreshold('Major', 'minor')).toBe(true);
      expect(checkSeverityThreshold('Major', 'trivial')).toBe(true);
      expect(checkSeverityThreshold('Minor', 'trivial')).toBe(true);
    });

    it('returns false when max severity is below threshold', () => {
      expect(checkSeverityThreshold('Major', 'critical')).toBe(false);
      expect(checkSeverityThreshold('Minor', 'critical')).toBe(false);
      expect(checkSeverityThreshold('Minor', 'major')).toBe(false);
      expect(checkSeverityThreshold('Trivial', 'critical')).toBe(false);
      expect(checkSeverityThreshold('Trivial', 'major')).toBe(false);
      expect(checkSeverityThreshold('Trivial', 'minor')).toBe(false);
    });

    it('handles mixed-case threshold input', () => {
      expect(checkSeverityThreshold('Critical', 'CRITICAL')).toBe(true);
      expect(checkSeverityThreshold('Major', 'Major')).toBe(true);
      expect(checkSeverityThreshold('Minor', 'MINOR')).toBe(true);
    });

    it('returns false for unrecognised threshold value', () => {
      expect(checkSeverityThreshold('Critical', 'unknown')).toBe(false);
    });

    it('returns false for unrecognised max severity value', () => {
      expect(checkSeverityThreshold('unknown', 'critical')).toBe(false);
    });
  });
});
