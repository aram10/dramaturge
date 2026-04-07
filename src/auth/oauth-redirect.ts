import type { OAuthRedirectStep } from '../config.js';
import {
  adaptDeterministicAuthPage,
  getPrimaryPage,
  type AuthBrowserPage,
  type BrowserSessionLike,
} from '../browser/page-interface.js';
import { parseIndicator, waitForSuccess } from './success-indicator.js';

export async function authenticateOAuthRedirect(
  browser: BrowserSessionLike<AuthBrowserPage>,
  targetUrl: string,
  loginUrl: string,
  steps: OAuthRedirectStep[],
  successIndicator: string
): Promise<void> {
  const page = adaptDeterministicAuthPage(getPrimaryPage(browser, 'OAuth redirect authentication'));
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  for (const step of steps) {
    switch (step.type) {
      case 'click':
        await page.click(step.selector);
        break;
      case 'fill':
        await page.fill(step.selector, step.value);
        break;
      case 'wait-for-selector':
        await page.waitForSelector(step.selector);
        break;
    }
  }

  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
