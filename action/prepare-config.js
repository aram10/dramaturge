#!/usr/bin/env node

/**
 * Prepares a Dramaturge config for CI execution.
 *
 * Reads the user config (if present), ensures JSON output is enabled,
 * forces headless mode, and writes a generated config file next to
 * the original config so relative paths keep the same meaning.
 *
 * Environment variables:
 *   INPUT_CONFIG      – path to the user config file
 *   INPUT_TARGET_URL  – target URL override
 *   INPUT_REPORT_DIR  – report directory override
 *   GITHUB_OUTPUT     – GitHub Actions output file
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsoncObject } from '../src/utils/jsonc.shared.js';

export function prepareConfigForCi({
  configPath = process.env.INPUT_CONFIG || 'dramaturge.config.json',
  targetUrl = process.env.INPUT_TARGET_URL || '',
  reportDir = process.env.INPUT_REPORT_DIR || '',
} = {}) {
  let config = {};
  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);

  if (existsSync(resolvedConfigPath)) {
    const raw = readFileSync(resolvedConfigPath, 'utf-8');
    config = parseJsoncObject(raw);
  }

  if (targetUrl) config.targetUrl = targetUrl;

  // Ensure JSON output is available for result parsing
  config.output = config.output || {};
  if (config.output.format === 'markdown') {
    config.output.format = 'both';
  } else if (!config.output.format) {
    config.output.format = 'json';
  }

  if (reportDir) config.output.dir = reportDir;

  // Force headless mode in CI
  config.browser = config.browser || {};
  config.browser.headless = true;

  mkdirSync(configDir, { recursive: true });

  const preparedConfigPath = join(configDir, `.dramaturge-ci-config-${process.pid}.json`);
  writeFileSync(preparedConfigPath, JSON.stringify(config, null, 2));

  const effectiveReportDir = resolve(configDir, config.output.dir || './dramaturge-reports');

  return {
    configPath: preparedConfigPath,
    reportDir: effectiveReportDir,
  };
}

function main() {
  const prepared = prepareConfigForCi();
  const githubOutput = process.env.GITHUB_OUTPUT || '';

  if (githubOutput) {
    appendFileSync(githubOutput, `config-path=${prepared.configPath}\n`);
    appendFileSync(githubOutput, `report-dir=${prepared.reportDir}\n`);
  }

  console.log(`Config written to: ${prepared.configPath}`);
  console.log(`Report dir: ${prepared.reportDir}`);
}

if (typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
