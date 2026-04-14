// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { accessSync, constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface DoctorCheckResult {
  label: string;
  ok: boolean;
  message: string;
  fix?: string;
}

export interface DoctorDependencies {
  log: (message: string) => void;
  cwd: string;
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

function checkPlaywrightBrowser(): DoctorCheckResult {
  const browsersPath =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve(homedir(), '.cache', 'ms-playwright');
  const exists = existsSync(browsersPath);
  return {
    label: 'Playwright browsers',
    ok: exists,
    message: exists ? `Found at ${browsersPath}` : 'Not found',
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
    checkPlaywrightBrowser(),
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

/**
 * Run the doctor command: execute checks and print results.
 * Returns 0 for all-pass, 1 if any check fails.
 */
export function runDoctor(deps: DoctorDependencies): number {
  const results = runDoctorChecks(deps.cwd);
  const allOk = printDoctorResults(results, deps);
  return allOk ? 0 : 1;
}
