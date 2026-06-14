// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { AUTH_SETTLE_DELAY_MS, MAX_AUTH_CONFIRM_ATTEMPTS } from '../constants.js';

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
      await page.waitForTimeout(AUTH_SETTLE_DELAY_MS);
      io.log('Login detected. Saving browser state...');
    } catch {
      timedOut = true;
      io.log('Timed out waiting for the success URL. Saving the current browser state anyway.');
    }

    ensureParentDir(outputPath);
    await context.storageState({ path: outputPath });
    restrictFilePermissions(outputPath);
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
  const maxAttempts = options.maxAttempts ?? MAX_AUTH_CONFIRM_ATTEMPTS;

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
        restrictFilePermissions(outputPath);
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
    // Auth-state files hold live session cookies/tokens; keep the directory
    // owner-only so other users on shared/CI hosts cannot read them.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// The storage-state JSON contains live session tokens. Playwright writes the
// file itself, so restrict permissions to the owner after the write. chmod is a
// best-effort no-op on platforms (e.g. Windows) that ignore POSIX modes.
function restrictFilePermissions(filePath: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}
