import type { BrowserSessionLike, StorageStatePage } from '../browser/page-interface.js';
import { getPrimaryPage } from '../browser/page-interface.js';

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
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: StorageStateOrigin[];
}

export async function applyStorageState(
  browser: BrowserSessionLike<StorageStatePage>,
  targetUrl: string,
  state: BrowserStorageState
): Promise<void> {
  const page = getPrimaryPage(browser, 'auth state operations');

  if (state.cookies?.length) {
    if (typeof browser.context.addCookies !== 'function') {
      throw new Error('Browser context does not support adding cookies.');
    }
    await browser.context.addCookies(
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

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  const targetOrigin = new URL(targetUrl).origin;
  const matchingOrigin = state.origins?.find(
    (origin) => origin.origin === targetOrigin && origin.localStorage?.length > 0
  );

  if (!matchingOrigin) return;

  await page.evaluate((items: Array<{ name: string; value: string }>) => {
    for (const item of items) {
      localStorage.setItem(item.name, item.value);
    }
  }, matchingOrigin.localStorage);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
}

export async function captureStorageState(
  browser: BrowserSessionLike<StorageStatePage>,
  targetUrl: string
): Promise<BrowserStorageState> {
  const page = getPrimaryPage(browser, 'auth state capture');
  if (typeof browser.context.cookies !== 'function') {
    throw new Error('Browser context does not support reading cookies.');
  }
  const cookies = await browser.context.cookies();
  const localStorage = await page.evaluate(() => {
    const items: Array<{ name: string; value: string }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) items.push({ name: key, value: window.localStorage.getItem(key) ?? '' });
    }
    return items;
  });

  return {
    cookies,
    origins: [{ origin: new URL(targetUrl).origin, localStorage }],
  };
}
