import type { Stagehand } from "@browserbasehq/stagehand";
import { parseIndicator, waitForSuccess } from "./success-indicator.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export async function authenticateForm(
  stagehand: Stagehand,
  targetUrl: string,
  loginUrl: string,
  credentials: Record<string, string>,
  successIndicator: string
): Promise<void> {
  const page: StagehandPage = stagehand.context.pages()[0];
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  // Fill each credential field using act()
  for (const [fieldName, value] of Object.entries(credentials)) {
    await stagehand.act(`Type "${value}" into the ${fieldName} field`);
  }

  // Submit the form
  await stagehand.act("Click the submit or sign-in button");

  // Wait for success
  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
