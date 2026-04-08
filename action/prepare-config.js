#!/usr/bin/env node

/**
 * Prepares a Dramaturge config for CI execution.
 *
 * Reads the user config (if present), applies explicit action overrides,
 * and writes a temporary config file next to the original so relative
 * paths keep the same meaning.
 *
 * Environment variables:
 *   INPUT_CONFIG      – path to the user config file
 *   INPUT_TARGET_URL  – target URL override
 *   INPUT_REPORT_DIR  – report directory override
 *   INPUT_FORCE_JSON_OUTPUT – whether to ensure JSON output is enabled
 *   INPUT_FORCE_HEADLESS – whether to force browser.headless=true
 *   GITHUB_OUTPUT     – GitHub Actions output file
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Strips JSONC comments while preserving content inside strings
 * (e.g. URLs containing "//"). Mirrors src/utils/jsonc.ts.
 */
function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < input.length; i++) {
    const current = input[i];
    const next = input[i + 1];

    if (inString) {
      output += current;
      if (isEscaped) {
        isEscaped = false;
      } else if (current === '\\') {
        isEscaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }

    if (current === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      if (i < input.length) {
        output += input[i];
      }
      continue;
    }

    if (current === '/' && next === '*') {
      i += 2;
      while (i < input.length - 1) {
        if (input[i] === '*' && input[i + 1] === '/') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    output += current;
  }

  return output;
}

/**
 * Parses a GitHub Actions boolean input string while supporting a fallback.
 *
 * @param {string | undefined | null} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
export function parseBooleanInput(value, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue === '' ? defaultValue : normalizedValue === 'true';
}

/**
 * Applies the action's explicit inputs on top of the loaded user config.
 *
 * @param {Record<string, any>} config
 * @param {{
 *   targetUrl?: string,
 *   reportDir?: string,
 *   forceJsonOutput?: boolean,
 *   forceHeadless?: boolean,
 * }} [options]
 * @returns {Record<string, any>}
 */
export function applyActionOverrides(
  config,
  { targetUrl = '', reportDir = '', forceJsonOutput = true, forceHeadless = true } = {}
) {
  const nextConfig = { ...config };

  if (targetUrl) {
    nextConfig.targetUrl = targetUrl;
  }

  if (forceJsonOutput || reportDir) {
    nextConfig.output = { ...(config.output || {}) };
  }

  // Ensure JSON output is available for result parsing when explicitly enabled.
  if (forceJsonOutput) {
    if (nextConfig.output.format === 'markdown') {
      nextConfig.output.format = 'both';
    } else if (!nextConfig.output.format) {
      nextConfig.output.format = 'json';
    }
  }

  if (reportDir) {
    nextConfig.output.dir = reportDir;
  }

  if (forceHeadless) {
    nextConfig.browser = { ...(config.browser || {}) };
    nextConfig.browser.headless = true;
  }

  return nextConfig;
}

/**
 * Returns whether the prepared config will emit a JSON report.
 *
 * @param {Record<string, any>} config
 * @returns {boolean}
 */
export function isJsonOutputEnabled(config) {
  const format = config.output?.format;
  return format === 'json' || format === 'both';
}

/**
 * Loads a user config file, layers explicit action overrides, writes the
 * temporary CI config file, and returns the generated paths.
 *
 * @param {{
 *   configPath?: string,
 *   targetUrl?: string,
 *   reportDir?: string,
 *   forceJsonOutput?: boolean,
 *   forceHeadless?: boolean,
 *   githubOutput?: string,
 * }} [options]
 * @returns {{
 *   config: Record<string, any>,
 *   configPath: string,
 *   reportDir: string,
 *   jsonOutputEnabled: boolean,
 * }}
 */
export function prepareConfig({
  configPath = 'dramaturge.config.json',
  targetUrl = '',
  reportDir = '',
  forceJsonOutput = true,
  forceHeadless = true,
  githubOutput = '',
} = {}) {
  let config = {};
  const resolvedConfigPath = resolve(configPath);

  if (existsSync(resolvedConfigPath)) {
    const raw = readFileSync(resolvedConfigPath, 'utf-8');
    config = JSON.parse(stripJsonComments(raw));
  }

  const preparedConfig = applyActionOverrides(config, {
    targetUrl,
    reportDir,
    forceJsonOutput,
    forceHeadless,
  });

  const configDir = dirname(resolvedConfigPath);
  mkdirSync(configDir, { recursive: true });

  const tmpConfig = join(configDir, `.dramaturge-ci-config-${process.pid}.json`);
  writeFileSync(tmpConfig, JSON.stringify(preparedConfig, null, 2));

  const effectiveReportDir = resolve(configDir, preparedConfig.output?.dir || './dramaturge-reports');
  const jsonOutputEnabled = isJsonOutputEnabled(preparedConfig);

  if (githubOutput) {
    appendFileSync(githubOutput, `config-path=${tmpConfig}\n`);
    appendFileSync(githubOutput, `report-dir=${effectiveReportDir}\n`);
    appendFileSync(githubOutput, `json-output-enabled=${String(jsonOutputEnabled)}\n`);
  }

  return {
    config: preparedConfig,
    configPath: tmpConfig,
    reportDir: effectiveReportDir,
    jsonOutputEnabled,
  };
}

function main() {
  const result = prepareConfig({
    configPath: process.env.INPUT_CONFIG || 'dramaturge.config.json',
    targetUrl: process.env.INPUT_TARGET_URL || '',
    reportDir: process.env.INPUT_REPORT_DIR || '',
    forceJsonOutput: parseBooleanInput(process.env.INPUT_FORCE_JSON_OUTPUT, true),
    forceHeadless: parseBooleanInput(process.env.INPUT_FORCE_HEADLESS, true),
    githubOutput: process.env.GITHUB_OUTPUT || '',
  });

  console.log(`Config written to: ${result.configPath}`);
  console.log(`Report dir: ${result.reportDir}`);
}

if (typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
