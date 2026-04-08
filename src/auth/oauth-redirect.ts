import type { OAuthRedirectStep } from '../config.js';
import { setInputRecordingPolicy } from '../worker/input-recording-policy.js';
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
  const primaryPage = getPrimaryPage(browser, 'OAuth redirect authentication');
  const page = adaptDeterministicAuthPage(primaryPage);
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  for (const step of steps) {
    switch (step.type) {
      case 'click':
        await page.click(step.selector);
        break;
      case 'fill':
        setInputRecordingPolicy(
          primaryPage as object,
          step.selector,
          step.secret ? 'secret' : 'safe'
        );
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
