import { readFileSync } from "node:fs";
import type { Stagehand } from "@browserbasehq/stagehand";
import { parseIndicator, waitForSuccess } from "./success-indicator.js";
import { applyStorageState, type BrowserStorageState } from "./storage-state.js";

export async function authenticateStoredState(
  stagehand: Stagehand,
  targetUrl: string,
  stateFile: string,
  successIndicator?: string
): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(stateFile, "utf-8");
  } catch {
    throw new Error(`Storage state file not found: ${stateFile}`);
  }

  let state: BrowserStorageState;
  try {
    state = JSON.parse(raw) as BrowserStorageState;
  } catch {
    throw new Error(`Invalid JSON in storage state file: ${stateFile}`);
  }
  await applyStorageState(stagehand, targetUrl, state);

  // Verify that injected state is actually valid
  const page = stagehand.context.pages()[0];
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
