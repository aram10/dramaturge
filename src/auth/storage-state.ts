import type { Stagehand } from "@browserbasehq/stagehand";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface StorageStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

export interface BrowserStorageState {
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

function getPrimaryPage(stagehand: Stagehand): StagehandPage {
  const page = stagehand.context.pages()[0];
  if (!page) {
    throw new Error("No browser page available for auth state operations.");
  }
  return page;
}

export async function applyStorageState(
  stagehand: Stagehand,
  targetUrl: string,
  state: BrowserStorageState
): Promise<void> {
  const page = getPrimaryPage(stagehand);

  if (state.cookies?.length) {
    await stagehand.context.addCookies(
      state.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        expires: cookie.expires > 0 ? cookie.expires : undefined,
      }))
    );
  }

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  const targetOrigin = new URL(targetUrl).origin;
  const matchingOrigin = state.origins?.find((origin) =>
    origin.origin === targetOrigin && origin.localStorage?.length > 0
  );

  if (!matchingOrigin) return;

  await page.evaluate(
    (items: Array<{ name: string; value: string }>) => {
      for (const item of items) {
        localStorage.setItem(item.name, item.value);
      }
    },
    matchingOrigin.localStorage
  );

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

export async function captureStorageState(
  stagehand: Stagehand,
  targetUrl: string
): Promise<BrowserStorageState> {
  const page = getPrimaryPage(stagehand);
  const cookies = await stagehand.context.cookies();
  const localStorage = await page.evaluate(() => {
    const items: Array<{ name: string; value: string }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) items.push({ name: key, value: window.localStorage.getItem(key) ?? "" });
    }
    return items;
  });

  return {
    cookies,
    origins: [{ origin: new URL(targetUrl).origin, localStorage }],
  };
}
