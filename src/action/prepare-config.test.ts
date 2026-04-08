import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { prepareConfigForCi } from '../../action/prepare-config.js';

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

describe('prepareConfigForCi', () => {
  it('writes the generated config next to the original config and preserves relative path semantics', () => {
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

    const prepared = prepareConfigForCi({ configPath });
    const loaded = loadConfig(prepared.configPath);

    expect(dirname(prepared.configPath)).toBe(configDir);
    expect(prepared.reportDir).toBe(resolve(configDir, 'reports'));
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

    const prepared = prepareConfigForCi({
      configPath,
      reportDir: './ci-reports',
    });
    const loaded = loadConfig(prepared.configPath);

    expect(prepared.reportDir).toBe(resolve(configDir, 'ci-reports'));
    expect(loaded.output.dir).toBe(resolve(configDir, 'ci-reports'));
  });

  it('creates the config directory when no user config file exists yet', () => {
    const repoDir = createTempDir();
    const configPath = join(repoDir, 'missing', 'nested', 'dramaturge.config.json');

    const prepared = prepareConfigForCi({
      configPath,
      targetUrl: 'https://example.com/app',
    });
    const preparedConfig = JSON.parse(readFileSync(prepared.configPath, 'utf-8'));

    expect(dirname(prepared.configPath)).toBe(resolve(repoDir, 'missing', 'nested'));
    expect(existsSync(prepared.configPath)).toBe(true);
    expect(prepared.reportDir).toBe(resolve(repoDir, 'missing', 'nested', 'dramaturge-reports'));
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
