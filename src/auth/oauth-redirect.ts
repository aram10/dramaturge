import type { Stagehand } from '@browserbasehq/stagehand';
import type { OAuthRedirectStep } from '../config.js';
import { setInputRecordingPolicy } from '../worker/input-recording-policy.js';
import { parseIndicator, waitForSuccess } from './success-indicator.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

async function fillSelector(page: StagehandPage, selector: string, value: string): Promise<void> {
  const playwrightPage = page as any;
  if (typeof playwrightPage.fill === 'function') {
    await playwrightPage.fill(selector, value);
    return;
  }
  if (typeof playwrightPage.locator === 'function') {
    await playwrightPage.locator(selector).fill(value);
    return;
  }
  throw new Error(`Page does not support deterministic fill for selector: ${selector}`);
}

async function clickSelector(page: StagehandPage, selector: string): Promise<void> {
  const playwrightPage = page as any;
  if (typeof playwrightPage.click === 'function') {
    await playwrightPage.click(selector);
    return;
  }
  if (typeof playwrightPage.locator === 'function') {
    await playwrightPage.locator(selector).click();
    return;
  }
  throw new Error(`Page does not support deterministic click for selector: ${selector}`);
}

async function waitForSelector(page: StagehandPage, selector: string): Promise<void> {
  const playwrightPage = page as any;
  if (typeof playwrightPage.waitForSelector === 'function') {
    await playwrightPage.waitForSelector(selector);
    return;
  }
  if (typeof playwrightPage.locator === 'function') {
    await playwrightPage.locator(selector).waitFor();
    return;
  }
  throw new Error(`Page does not support selector waiting for: ${selector}`);
}

export async function authenticateOAuthRedirect(
  stagehand: Stagehand,
  targetUrl: string,
  loginUrl: string,
  steps: OAuthRedirectStep[],
  successIndicator: string
): Promise<void> {
  const page: StagehandPage = stagehand.context.pages()[0];
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  for (const step of steps) {
    switch (step.type) {
      case 'click':
        await clickSelector(page, step.selector);
        break;
      case 'fill':
        setInputRecordingPolicy(page as object, step.selector, step.secret ? 'secret' : 'safe');
        await fillSelector(page, step.selector, step.value);
        break;
      case 'wait-for-selector':
        await waitForSelector(page, step.selector);
        break;
    }
  }

  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
