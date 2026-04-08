import { readFileSync } from 'node:fs';
import type { BrowserSessionLike, StorageStatePage } from '../browser/page-interface.js';
import { getPrimaryPage } from '../browser/page-interface.js';
import { parseIndicator, waitForSuccess } from './success-indicator.js';
import { applyStorageState, type BrowserStorageState } from './storage-state.js';

export async function authenticateStoredState(
  browser: BrowserSessionLike<StorageStatePage>,
  targetUrl: string,
  stateFile: string,
  successIndicator?: string
): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(stateFile, 'utf-8');
  } catch {
    throw new Error(`Storage state file not found: ${stateFile}`);
  }

  let state: BrowserStorageState;
  try {
    state = JSON.parse(raw) as BrowserStorageState;
  } catch {
    throw new Error(`Failed to parse storage state JSON: ${stateFile}`);
  }
  await applyStorageState(browser, targetUrl, state);

  // Verify that injected state is actually valid
  const page = getPrimaryPage(browser, 'stored-state authentication');
  if (successIndicator) {
    const indicator = parseIndicator(successIndicator);
    await waitForSuccess(page, indicator, 15_000).catch(() => {
      throw new Error(
        `Stored browser state appears expired or invalid — success indicator "${successIndicator}" not detected. ` +
          `Re-export your browser state or switch to auth type "interactive" for automatic refresh.`
      );
    });
  }
}
