#!/usr/bin/env node

/**
 * Prepares a Dramaturge config for CI execution.
 *
 * Reads the user config (if present), ensures JSON output is enabled,
 * forces headless mode, and writes a temporary config file.
 *
 * Environment variables:
 *   INPUT_CONFIG      – path to the user config file
 *   INPUT_TARGET_URL  – target URL override
 *   INPUT_REPORT_DIR  – report directory override
 *   RUNNER_TEMP       – GitHub Actions runner temp directory
 *   GITHUB_OUTPUT     – GitHub Actions output file
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const configPath = process.env.INPUT_CONFIG || "dramaturge.config.json";
const targetUrl = process.env.INPUT_TARGET_URL || "";
const reportDir = process.env.INPUT_REPORT_DIR || "";
const runnerTemp = process.env.RUNNER_TEMP || "/tmp";
const githubOutput = process.env.GITHUB_OUTPUT || "";

let config = {};
if (existsSync(configPath)) {
  const raw = readFileSync(configPath, "utf-8");
  // Strip JSONC single-line and multi-line comments
  const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  config = JSON.parse(stripped);
}

if (targetUrl) config.targetUrl = targetUrl;

// Ensure JSON output is available for result parsing
config.output = config.output || {};
if (config.output.format === "markdown") {
  config.output.format = "both";
} else if (!config.output.format) {
  config.output.format = "json";
}

if (reportDir) config.output.dir = reportDir;

// Force headless mode in CI
config.browser = config.browser || {};
config.browser.headless = true;

const tmpConfig = join(runnerTemp, "dramaturge-ci-config.json");
writeFileSync(tmpConfig, JSON.stringify(config, null, 2));

const effectiveReportDir = config.output.dir || "./dramaturge-reports";

if (githubOutput) {
  appendFileSync(githubOutput, `config-path=${tmpConfig}\n`);
  appendFileSync(githubOutput, `report-dir=${effectiveReportDir}\n`);
}

console.log(`Config written to: ${tmpConfig}`);
console.log(`Report dir: ${effectiveReportDir}`);
