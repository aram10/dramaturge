// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

export interface DoctorCheckResult {
  label: string;
  ok: boolean;
  message: string;
  fix?: string;
}

export interface DoctorDependencies {
  log: (message: string) => void;
  cwd: string;
  confirm?: (question: string, defaultValue?: boolean) => Promise<boolean>;
  spawnImpl?: typeof spawn;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

function checkNodeVersion(): DoctorCheckResult {
  const version = process.versions.node;
  const major = Number.parseInt(version.split('.')[0], 10);
  return {
    label: 'Node.js version',
    ok: major >= 20,
    message: major >= 20 ? `v${version}` : `v${version} (requires ≥20)`,
    fix: major < 20 ? 'Install Node.js 20+ from https://nodejs.org' : undefined,
  };
}

function resolvePlaywrightBrowsersPath(cwd: string): string {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!configured) {
    if (process.platform === 'win32') {
      return resolve(
        process.env.LOCALAPPDATA ?? resolve(homedir(), 'AppData', 'Local'),
        'ms-playwright'
      );
    }
    if (process.platform === 'darwin') {
      return resolve(homedir(), 'Library', 'Caches', 'ms-playwright');
    }
    return resolve(homedir(), '.cache', 'ms-playwright');
  }

  if (configured === '0') {
    return resolve(cwd, 'node_modules', 'playwright', '.local-browsers');
  }

  return isAbsolute(configured) ? configured : resolve(cwd, configured);
}

function hasChromiumInstalled(browsersPath: string): boolean {
  if (!existsSync(browsersPath)) {
    return false;
  }

  try {
    const entries = readdirSync(browsersPath, { withFileTypes: true });
    return entries.some(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.startsWith('chromium-') || entry.name.startsWith('chromium_headless_shell-'))
    );
  } catch {
    return false;
  }
}

function checkPlaywrightChromium(cwd: string): DoctorCheckResult {
  const browsersPath = resolvePlaywrightBrowsersPath(cwd);
  const exists = hasChromiumInstalled(browsersPath);
  return {
    label: 'Playwright Chromium',
    ok: exists,
    message: exists ? `Found in ${browsersPath}` : `Not found in ${browsersPath}`,
    fix: !exists ? 'Run: npx playwright install chromium' : undefined,
  };
}

function checkConfigFile(cwd: string): DoctorCheckResult {
  const candidates = ['dramaturge.config.json', 'dramaturge.config.jsonc'];
  for (const name of candidates) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      return {
        label: 'Config file',
        ok: true,
        message: `Found ${name}`,
      };
    }
  }
  return {
    label: 'Config file',
    ok: true, // ok because config is optional now
    message: 'Not found (optional — use "dramaturge run <url>" for config-less mode)',
  };
}

function checkApiKey(envVar: string, label: string): DoctorCheckResult {
  const present = !!process.env[envVar];
  return {
    label: `${label} API key`,
    ok: present,
    message: present ? `${envVar} is set` : `${envVar} is not set`,
    fix: !present ? `Set ${envVar} in your environment or .env file` : undefined,
  };
}

function checkAnyApiKey(): DoctorCheckResult {
  const keys = [
    { env: 'ANTHROPIC_API_KEY', name: 'Anthropic' },
    { env: 'OPENAI_API_KEY', name: 'OpenAI' },
    { env: 'GOOGLE_GENERATIVE_AI_API_KEY', name: 'Google' },
    { env: 'AZURE_AI_API_KEY', name: 'Azure AI Foundry' },
    { env: 'OPENROUTER_API_KEY', name: 'OpenRouter' },
    { env: 'GITHUB_TOKEN', name: 'GitHub Models' },
  ];
  const found = keys.filter((k) => !!process.env[k.env]);
  if (found.length > 0) {
    return {
      label: 'LLM API key',
      ok: true,
      message: `Found: ${found.map((k) => k.name).join(', ')}`,
    };
  }
  return {
    label: 'LLM API key',
    ok: false,
    message: 'No API key found',
    fix: 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, AZURE_AI_API_KEY, OPENROUTER_API_KEY, or GITHUB_TOKEN in your environment or .env file',
  };
}

function checkAzureEndpoint(): DoctorCheckResult {
  const hasKey = !!process.env.AZURE_AI_API_KEY;
  const hasEndpoint = !!process.env.AZURE_AI_ENDPOINT;

  if (!hasKey) {
    return {
      label: 'Azure AI Foundry endpoint',
      ok: true, // not relevant when key is not set
      message: 'AZURE_AI_API_KEY not set (skipped)',
    };
  }

  return {
    label: 'Azure AI Foundry endpoint',
    ok: hasEndpoint,
    message: hasEndpoint
      ? `AZURE_AI_ENDPOINT is set`
      : 'AZURE_AI_ENDPOINT is not set (required when using Azure)',
    fix: !hasEndpoint
      ? 'Set AZURE_AI_ENDPOINT to your Azure AI Foundry resource URL (e.g. https://my-project.services.ai.azure.com)'
      : undefined,
  };
}

function checkOutputDir(cwd: string): DoctorCheckResult {
  const dir = resolve(cwd, 'dramaturge-reports');
  try {
    accessSync(cwd, constants.W_OK);
    return {
      label: 'Output directory',
      ok: true,
      message: `${dir} (writable)`,
    };
  } catch {
    return {
      label: 'Output directory',
      ok: false,
      message: `${dir} (not writable)`,
      fix: `Ensure you have write access to ${cwd}`,
    };
  }
}

/**
 * Run all preflight checks and return structured results.
 */
export function runDoctorChecks(cwd: string): DoctorCheckResult[] {
  return [
    checkNodeVersion(),
    checkPlaywrightChromium(cwd),
    checkConfigFile(cwd),
    checkAnyApiKey(),
    checkApiKey('ANTHROPIC_API_KEY', 'Anthropic'),
    checkApiKey('OPENAI_API_KEY', 'OpenAI'),
    checkApiKey('GOOGLE_GENERATIVE_AI_API_KEY', 'Google'),
    checkApiKey('AZURE_AI_API_KEY', 'Azure AI Foundry'),
    checkAzureEndpoint(),
    checkApiKey('OPENROUTER_API_KEY', 'OpenRouter'),
    checkApiKey('GITHUB_TOKEN', 'GitHub Models'),
    checkOutputDir(cwd),
  ];
}

/**
 * Print doctor check results to the terminal.
 */
export function printDoctorResults(
  results: DoctorCheckResult[],
  deps: DoctorDependencies
): boolean {
  deps.log('Dramaturge Doctor\n');

  let allOk = true;
  for (const check of results) {
    const icon = check.ok ? '✓' : '✗';
    deps.log(`  ${icon} ${check.label}: ${check.message}`);
    if (check.fix) {
      deps.log(`    → Fix: ${check.fix}`);
    }
    if (!check.ok) allOk = false;
  }

  deps.log('');
  if (allOk) {
    deps.log('All checks passed. You are ready to run Dramaturge.');
  } else {
    deps.log('Some checks failed. Please address the issues above.');
  }

  return allOk;
}

function canPrompt(deps: DoctorDependencies): boolean {
  if (!deps.confirm) {
    return false;
  }

  if (process.env.CI) {
    return false;
  }

  const stdin = deps.stdin ?? process.stdin;
  const stdout = deps.stdout ?? process.stdout;
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function runPlaywrightInstallChromium(
  deps: DoctorDependencies
): Promise<{ ok: boolean; exitCode: number | null }> {
  const spawnImpl = deps.spawnImpl ?? spawn;
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  deps.log('\nInstalling Playwright Chromium (npx playwright install chromium)...\n');

  return new Promise((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(npxCommand, ['playwright', 'install', 'chromium'], {
        stdio: 'inherit',
        env: process.env,
        cwd: deps.cwd,
      });
    } catch {
      resolvePromise({ ok: false, exitCode: null });
      return;
    }

    child.once('error', () => resolvePromise({ ok: false, exitCode: null }));
    child.once('exit', (code) => resolvePromise({ ok: code === 0, exitCode: code }));
  });
}

/**
 * Run the doctor command: execute checks and print results.
 * Returns 0 for all-pass, 1 if any check fails.
 */
export async function runDoctor(deps: DoctorDependencies): Promise<number> {
  let results = runDoctorChecks(deps.cwd);
  let allOk = printDoctorResults(results, deps);

  const chromiumCheck = results.find((result) => result.label === 'Playwright Chromium');
  const confirm = deps.confirm;
  if (chromiumCheck && !chromiumCheck.ok && confirm && canPrompt(deps)) {
    const confirmed = await confirm('Playwright Chromium is not installed. Install it now?', true);
    if (confirmed) {
      const install = await runPlaywrightInstallChromium(deps);
      if (!install.ok) {
        deps.log(
          `\nPlaywright install failed${install.exitCode === null ? '' : ` (exit ${install.exitCode})`}.\n`
        );
      }

      results = runDoctorChecks(deps.cwd);
      allOk = printDoctorResults(results, deps);
    }
  }

  return allOk ? 0 : 1;
}
