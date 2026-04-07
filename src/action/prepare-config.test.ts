import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyActionOverrides,
  parseBooleanInput,
  prepareConfig,
} from '../../action/prepare-config.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-prepare-config-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('prepare-config', () => {
  describe('parseBooleanInput', () => {
    it('uses the default for empty inputs', () => {
      expect(parseBooleanInput('', true)).toBe(true);
      expect(parseBooleanInput(undefined, false)).toBe(false);
    });

    it('parses explicit true and false values', () => {
      expect(parseBooleanInput('true', false)).toBe(true);
      expect(parseBooleanInput('TRUE', false)).toBe(true);
      expect(parseBooleanInput('false', true)).toBe(false);
    });
  });

  describe('applyActionOverrides', () => {
    it('applies the explicit CI overrides when enabled', () => {
      const prepared = applyActionOverrides(
        {
          targetUrl: 'https://config.example.com',
          output: { format: 'markdown', dir: './reports' },
          browser: { headless: false },
        },
        {
          targetUrl: 'https://input.example.com',
          reportDir: './ci-reports',
          forceJsonOutput: true,
          forceHeadless: true,
        }
      );

      expect(prepared).toEqual({
        targetUrl: 'https://input.example.com',
        output: { format: 'both', dir: './ci-reports' },
        browser: { headless: true },
      });
    });

    it('preserves user config semantics when overrides are disabled', () => {
      const prepared = applyActionOverrides(
        {
          output: { format: 'markdown', dir: './reports' },
          browser: { headless: false },
        },
        {
          forceJsonOutput: false,
          forceHeadless: false,
        }
      );

      expect(prepared).toEqual({
        output: { format: 'markdown', dir: './reports' },
        browser: { headless: false },
      });
    });
  });

  it('writes a temporary config file and supports JSONC comments', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');

    writeFileSync(
      configPath,
      `{
        // keep comment support
        "output": { "format": "markdown" },
        "browser": { "headless": false }
      }`,
      'utf-8'
    );

    const result = prepareConfig({
      configPath,
      reportDir: './ci-reports',
      runnerTemp: dir,
    });

    const written = JSON.parse(readFileSync(result.configPath, 'utf-8'));
    expect(written.output).toEqual({ format: 'both', dir: './ci-reports' });
    expect(written.browser).toEqual({ headless: true });
    expect(result.reportDir).toBe('./ci-reports');
  });
});
