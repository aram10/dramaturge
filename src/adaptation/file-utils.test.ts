import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatScanSizeLimit, readTextFileWithinLimit } from './file-utils.js';

describe('readTextFileWithinLimit', () => {
  it('returns null when the file exceeds the configured size limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dramaturge-scan-limit-'));
    try {
      const filePath = join(dir, 'large.ts');
      writeFileSync(filePath, 'x'.repeat(32));

      expect(readTextFileWithinLimit(filePath, 8)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('formats size limits for error messages', () => {
    expect(formatScanSizeLimit(1024)).toBe('1 KiB');
    expect(formatScanSizeLimit(1024 * 1024)).toBe('1 MiB');
  });
});
