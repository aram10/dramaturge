import type { FormAuthField, FormAuthSubmit } from '../config.js';
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
  const page = adaptDeterministicAuthPage(getPrimaryPage(browser, 'form authentication'));
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  for (const field of fields) {
    await page.fill(field.selector, field.value);
  }

  await page.click(submit.selector);

  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
