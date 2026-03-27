import type { Stagehand } from "@browserbasehq/stagehand";
import type { FormAuthField, FormAuthSubmit } from "../config.js";
import { parseIndicator, waitForSuccess } from "./success-indicator.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

async function fillSelector(page: StagehandPage, selector: string, value: string): Promise<void> {
  const playwrightPage = page as any;
  if (typeof playwrightPage.fill === "function") {
    await playwrightPage.fill(selector, value);
    return;
  }
  if (typeof playwrightPage.locator === "function") {
    await playwrightPage.locator(selector).fill(value);
    return;
  }
  throw new Error(`Page does not support deterministic fill for selector: ${selector}`);
}

async function clickSelector(page: StagehandPage, selector: string): Promise<void> {
  const playwrightPage = page as any;
  if (typeof playwrightPage.click === "function") {
    await playwrightPage.click(selector);
    return;
  }
  if (typeof playwrightPage.locator === "function") {
    await playwrightPage.locator(selector).click();
    return;
  }
  throw new Error(`Page does not support deterministic click for selector: ${selector}`);
}

export async function authenticateForm(
  stagehand: Stagehand,
  targetUrl: string,
  loginUrl: string,
  fields: FormAuthField[],
  submit: FormAuthSubmit,
  successIndicator: string
): Promise<void> {
  const page: StagehandPage = stagehand.context.pages()[0];
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  for (const field of fields) {
    await fillSelector(page, field.selector, field.value);
  }

  await clickSelector(page, submit.selector);

  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
