import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import {
  applyActionOverrides,
  isJsonOutputEnabled,
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

    it('trims surrounding whitespace before parsing', () => {
      expect(parseBooleanInput(' true\n', false)).toBe(true);
      expect(parseBooleanInput('  ', true)).toBe(true);
      expect(parseBooleanInput(' false ', true)).toBe(false);
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

  describe('isJsonOutputEnabled', () => {
    it('returns true for json and both formats', () => {
      expect(isJsonOutputEnabled({ output: { format: 'json' } })).toBe(true);
      expect(isJsonOutputEnabled({ output: { format: 'both' } })).toBe(true);
    });

    it('returns false for markdown-only output', () => {
      expect(isJsonOutputEnabled({ output: { format: 'markdown' } })).toBe(false);
    });
  });

  it('writes the temporary config beside the source config and resolves the report dir', () => {
    const dir = createTempDir();
    const configDir = join(dir, 'configs');
    const configPath = join(configDir, 'dramaturge.config.json');
    mkdirSync(configDir, { recursive: true });

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
    });

    const written = JSON.parse(readFileSync(result.configPath, 'utf-8'));
    expect(written.output).toEqual({ format: 'both', dir: './ci-reports' });
    expect(written.browser).toEqual({ headless: true });
    expect(result.configPath).toBe(
      join(dirname(resolve(configPath)), `.dramaturge-ci-config-${process.pid}.json`)
    );
    expect(result.reportDir).toBe(resolve(configDir, './ci-reports'));
    expect(result.jsonOutputEnabled).toBe(true);
  });

  it('reports when JSON output remains disabled', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');

    writeFileSync(
      configPath,
      `{
        "output": { "format": "markdown" }
      }`,
      'utf-8'
    );

    const result = prepareConfig({
      configPath,
      forceJsonOutput: false,
    });

    expect(result.jsonOutputEnabled).toBe(false);
    expect(result.reportDir).toBe(resolve(dir, './dramaturge-reports'));
  });

  it('preserves relative path semantics when loaded by loadConfig', () => {
    const repoDir = createTempDir();
    const configDir = join(repoDir, 'configs');
    mkdirSync(configDir);

    const configPath = join(configDir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          targetUrl: 'https://example.com/app',
          appDescription: 'Test app',
          auth: {
            type: 'stored-state',
            stateFile: './state/user.json',
          },
          output: {
            dir: './reports',
          },
          memory: {
            enabled: true,
            dir: './.dramaturge',
          },
          visualRegression: {
            enabled: true,
            baselineDir: './baselines',
          },
          repoContext: {
            root: '../app',
            framework: 'nextjs',
            hintsFile: './dramaturge.hints.jsonc',
            specFile: './dramaturge.openapi.json',
          },
          bootstrap: {
            command: 'pnpm dev',
            cwd: '../app',
          },
        },
        null,
        2
      )
    );

    const result = prepareConfig({ configPath });
    const loaded = loadConfig(result.configPath);

    expect(dirname(result.configPath)).toBe(configDir);
    expect(result.reportDir).toBe(resolve(configDir, 'reports'));
    expect(loaded.auth).toMatchObject({
      type: 'stored-state',
      stateFile: resolve(configDir, 'state/user.json'),
    });
    expect(loaded.output.dir).toBe(resolve(configDir, 'reports'));
    expect(loaded.memory?.dir).toBe(resolve(configDir, '.dramaturge'));
    expect(loaded.visualRegression?.baselineDir).toBe(resolve(configDir, 'baselines'));
    expect(loaded.repoContext).toMatchObject({
      root: resolve(repoDir, 'app'),
      hintsFile: resolve(repoDir, 'app/dramaturge.hints.jsonc'),
      specFile: resolve(repoDir, 'app/dramaturge.openapi.json'),
    });
    expect(loaded.bootstrap?.cwd).toBe(resolve(repoDir, 'app'));
  });

  it('returns an absolute report directory when a relative report-dir override is provided', () => {
    const repoDir = createTempDir();
    const configDir = join(repoDir, 'configs');
    mkdirSync(configDir);

    const configPath = join(configDir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app',
        auth: { type: 'none' },
      })
    );

    const result = prepareConfig({
      configPath,
      reportDir: './ci-reports',
    });
    const loaded = loadConfig(result.configPath);

    expect(result.reportDir).toBe(resolve(configDir, 'ci-reports'));
    expect(loaded.output.dir).toBe(resolve(configDir, 'ci-reports'));
  });

  it('creates the config directory when no user config file exists yet', () => {
    const repoDir = createTempDir();
    const configPath = join(repoDir, 'missing', 'nested', 'dramaturge.config.json');

    const result = prepareConfig({
      configPath,
      targetUrl: 'https://example.com/app',
    });
    const preparedConfig = JSON.parse(readFileSync(result.configPath, 'utf-8'));

    expect(dirname(result.configPath)).toBe(resolve(repoDir, 'missing', 'nested'));
    expect(existsSync(result.configPath)).toBe(true);
    expect(result.reportDir).toBe(resolve(repoDir, 'missing', 'nested', 'dramaturge-reports'));
    expect(preparedConfig).toMatchObject({
      targetUrl: 'https://example.com/app',
      output: {
        format: 'json',
      },
      browser: {
        headless: true,
      },
    });
  });
});
