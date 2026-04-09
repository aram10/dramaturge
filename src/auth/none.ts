// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { BrowserSessionLike, StorageStatePage } from '../browser/page-interface.js';
import { getPrimaryPage } from '../browser/page-interface.js';

export async function authenticateNone(
  browser: BrowserSessionLike<StorageStatePage>,
  targetUrl: string
): Promise<void> {
  const page = getPrimaryPage(browser, 'unauthenticated navigation');
  await page.goto(targetUrl);
}
