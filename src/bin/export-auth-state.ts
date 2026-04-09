#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

export interface ExportAuthStateArgs {
  url?: string;
  output?: string;
  successUrl?: string;
  timeoutSeconds: number;
  showHelp: boolean;
}

const HELP_TEXT = `Usage: dramaturge-auth-state --url <target-url> --output <path> [options]

Options:
  --url <target-url>        URL to open for manual sign-in
  --output <path>           File path where browser storage state will be saved
  --success-url <url>       URL that indicates sign-in succeeded (default: site root)
  --timeout-seconds <n>     How long to wait for login completion (default: 120)
  --help, -h                Show this help message
`;

export function buildExportAuthStateHelpText(): string {
  return HELP_TEXT;
}

export function parseExportAuthStateArgs(args: readonly string[]): ExportAuthStateArgs {
  let url: string | undefined;
  let output: string | undefined;
  let successUrl: string | undefined;
  let timeoutSeconds = 120;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      return { url, output, successUrl, timeoutSeconds, showHelp: true };
    }

    if (arg === '--url') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing required --url value');
      url = value;
      i++;
      continue;
    }

    if (arg === '--output') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing required --output value');
      output = value;
      i++;
      continue;
    }

    if (arg === '--success-url') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing required --success-url value');
      successUrl = value;
      i++;
      continue;
    }

    if (arg === '--timeout-seconds') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing required --timeout-seconds value');
      timeoutSeconds = Number.parseInt(value, 10);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) {
        throw new Error(`Invalid --timeout-seconds value: ${value}`);
      }
      i++;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!url) throw new Error('Missing required --url');
  if (!output) throw new Error('Missing required --output');

  return {
    url,
    output,
    successUrl: successUrl ?? new URL('/', url).href,
    timeoutSeconds,
    showHelp: false,
  };
}

export async function runExportAuthStateCli(
  args: readonly string[] = process.argv.slice(2),
  io: Pick<typeof console, 'log' | 'error'> = console
): Promise<number> {
  try {
    const parsed = parseExportAuthStateArgs(args);
    if (parsed.showHelp) {
      io.log(buildExportAuthStateHelpText());
      return 0;
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    const outputPath = resolve(parsed.output!);

    io.log(`Launching browser for manual sign-in at ${parsed.url}...`);
    await page.goto(parsed.url!);
    io.log(`Waiting up to ${parsed.timeoutSeconds}s for ${parsed.successUrl}...`);

    try {
      await page.waitForURL(parsed.successUrl!, {
        timeout: parsed.timeoutSeconds * 1000,
      });
      await page.waitForTimeout(5000);
      io.log('Login detected. Saving browser state...');
    } catch {
      io.log('Timed out waiting for the success URL. Saving the current browser state anyway.');
    }

    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    await context.storageState({ path: outputPath });
    io.log(`Saved browser state to ${outputPath}`);
    await browser.close();
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(`Error: ${message}`);
    return 1;
  }
}

const executedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  const exitCode = await runExportAuthStateCli();
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
