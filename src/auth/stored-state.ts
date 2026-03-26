import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Stagehand } from "@browserbasehq/stagehand";
import { parseIndicator, waitForSuccess } from "./success-indicator.js";

interface StorageStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: StorageStateOrigin[];
}

export async function authenticateStoredState(
  stagehand: Stagehand,
  targetUrl: string,
  stateFile: string,
  successIndicator?: string
): Promise<void> {
  const resolvedPath = resolve(stateFile);
  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf-8");
  } catch {
    throw new Error(`Storage state file not found: ${resolvedPath}`);
  }

  const state: StorageState = JSON.parse(raw);

  // Inject cookies
  if (state.cookies?.length) {
    await stagehand.context.addCookies(
      state.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires > 0 ? c.expires : undefined,
      }))
    );
  }

  // Navigate first so localStorage can be set on the correct origin
  const page = stagehand.context.pages()[0];
  await page.goto(targetUrl);

  // Inject localStorage for matching origin
  if (state.origins?.length) {
    const targetOrigin = new URL(targetUrl).origin;
    for (const origin of state.origins) {
      if (origin.origin === targetOrigin && origin.localStorage?.length) {
        await page.evaluate(
          (items: Array<{ name: string; value: string }>) => {
            for (const item of items) {
              localStorage.setItem(item.name, item.value);
            }
          },
          origin.localStorage
        );
      }
    }
    // Reload to apply injected state
    await page.goto(targetUrl);
  }

  // Verify that injected state is actually valid
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
