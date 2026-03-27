import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Stagehand } from "@browserbasehq/stagehand";
import { parseIndicator, waitForSuccess } from "./success-indicator.js";
import { applyStorageState, captureStorageState, type BrowserStorageState } from "./storage-state.js";

/**
 * Interactive auth strategy: tries cached browser state first, falling back to
 * a manual login where the human completes the flow in a visible browser.
 *
 * Flow:
 *  1. If `stateFile` exists, inject it and verify with `successIndicator`.
 *  2. If verification fails (or no file), navigate to `loginUrl` and wait for
 *     the human to complete login. Poll `successIndicator` with a generous
 *     timeout.
 *  3. Once authenticated, persist `context.storageState()` to `stateFile` for
 *     reuse in future runs.
 */
export async function authenticateInteractive(
  stagehand: Stagehand,
  targetUrl: string,
  loginUrl: string,
  successIndicator: string,
  stateFile: string,
  manualTimeoutMs: number = 120_000
): Promise<void> {
  const indicator = parseIndicator(successIndicator);

  // 1. Try cached state if it exists
  if (existsSync(stateFile)) {
    console.log("  Trying cached browser state…");
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf-8")) as BrowserStorageState;
      await applyStorageState(stagehand, targetUrl, state);

      // Quick check — 10 s timeout
      const page = stagehand.context.pages()[0];
      await waitForSuccess(page, indicator, 10_000);
      console.log("  Cached state is still valid.");
      return;
    } catch {
      console.log("  Cached state expired or invalid — falling back to manual login.");
    }
  }

  // 2. Manual login: navigate and wait for the human to complete
  const page = stagehand.context.pages()[0];
  const fullLoginUrl = loginUrl.startsWith("http")
    ? loginUrl
    : new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl, { waitUntil: "domcontentloaded" });
  console.log(`  Waiting for manual login (timeout: ${manualTimeoutMs / 1000}s)…`);
  console.log(`  Complete the login in the browser window. Success indicator: "${successIndicator}"`);

  await waitForSuccess(page, indicator, manualTimeoutMs);
  console.log("  Manual login detected — saving state for reuse.");

  // 3. Persist storage state
  const storageState = await captureStorageState(stagehand, targetUrl);
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(storageState, null, 2));
}
