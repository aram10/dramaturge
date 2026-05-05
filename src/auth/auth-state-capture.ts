// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

export interface AuthStateCaptureIo {
  log: (message: string) => void;
  error: (message: string) => void;
  prompt?: (question: string) => Promise<string>;
  confirm?: (question: string, defaultValue?: boolean) => Promise<boolean>;
}

export interface CaptureAuthStateViaSuccessUrlOptions {
  loginUrl: string;
  outputPath: string;
  successUrl: string;
  timeoutMs: number;
}

export interface CaptureAuthStateViaUserConfirmationOptions {
  loginUrl: string;
  outputPath: string;
  maxAttempts?: number;
}

export async function captureAuthStateViaSuccessUrl(
  options: CaptureAuthStateViaSuccessUrlOptions,
  io: AuthStateCaptureIo
): Promise<{ outputPath: string; timedOut: boolean }> {
  const outputPath = resolve(options.outputPath);

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    io.log(`Launching browser for manual sign-in at ${options.loginUrl}...`);
    await page.goto(options.loginUrl);
    io.log(`Waiting up to ${Math.round(options.timeoutMs / 1000)}s for ${options.successUrl}...`);

    let timedOut = false;
    try {
      await page.waitForURL(options.successUrl, {
        timeout: options.timeoutMs,
      });
      await page.waitForTimeout(5000);
      io.log('Login detected. Saving browser state...');
    } catch {
      timedOut = true;
      io.log('Timed out waiting for the success URL. Saving the current browser state anyway.');
    }

    ensureParentDir(outputPath);
    await context.storageState({ path: outputPath });
    io.log(`Saved browser state to ${outputPath}`);

    return { outputPath, timedOut };
  } finally {
    await browser.close().catch(() => {
      // best-effort
    });
  }
}

export async function captureAuthStateViaUserConfirmation(
  options: CaptureAuthStateViaUserConfirmationOptions,
  io: AuthStateCaptureIo
): Promise<{ outputPath: string; confirmed: boolean }> {
  if (!io.prompt || !io.confirm) {
    throw new Error('Auth capture requires interactive prompt/confirm I/O.');
  }

  const outputPath = resolve(options.outputPath);
  const maxAttempts = options.maxAttempts ?? 3;

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    io.log(`Launching browser for manual sign-in at ${options.loginUrl}...`);
    await page.goto(options.loginUrl);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await io.prompt(
        attempt === 1
          ? 'Press Enter once you have finished logging in'
          : 'Press Enter once you have tried logging in again'
      );

      const url = page.url();
      const title = await page.title().catch(() => '(unable to read title)');
      io.log(`Current page: ${url}`);
      io.log(`Title: ${title}`);

      const confirmed = await io.confirm('Did login succeed?', true);
      if (confirmed) {
        ensureParentDir(outputPath);
        await context.storageState({ path: outputPath });
        io.log(`Saved browser state to ${outputPath}`);
        return { outputPath, confirmed: true };
      }

      const retry = await io.confirm('Keep the browser open and try again?', attempt < maxAttempts);
      if (!retry) {
        return { outputPath, confirmed: false };
      }
    }

    return { outputPath, confirmed: false };
  } finally {
    await browser.close().catch(() => {
      // best-effort
    });
  }
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
