import type { Stagehand } from '@browserbasehq/stagehand';

export async function authenticateNone(stagehand: Stagehand, targetUrl: string): Promise<void> {
  const page = stagehand.context.pages()[0];
  await page.goto(targetUrl);
}
