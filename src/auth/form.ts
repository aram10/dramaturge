// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { FormAuthField, FormAuthSubmit } from '../config.js';
import { setInputRecordingPolicy } from '../worker/input-recording-policy.js';
import {
  adaptDeterministicAuthPage,
  getPrimaryPage,
  type AuthBrowserPage,
  type BrowserSessionLike,
} from '../browser/page-interface.js';
import { parseIndicator, waitForSuccess } from './success-indicator.js';

export async function authenticateForm(
  browser: BrowserSessionLike<AuthBrowserPage>,
  targetUrl: string,
  loginUrl: string,
  fields: FormAuthField[],
  submit: FormAuthSubmit,
  successIndicator: string
): Promise<void> {
  const primaryPage = getPrimaryPage(browser, 'form authentication');
  const page = adaptDeterministicAuthPage(primaryPage);
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  for (const field of fields) {
    setInputRecordingPolicy(
      primaryPage as object,
      field.selector,
      field.secret ? 'secret' : 'safe'
    );
    await page.fill(field.selector, field.value);
  }

  await page.click(submit.selector);

  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
