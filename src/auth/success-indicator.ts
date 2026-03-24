import type { Stagehand } from "@browserbasehq/stagehand";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export type IndicatorType = "url" | "selector" | "text";

export interface ParsedIndicator {
  type: IndicatorType;
  value: string;
}

export function parseIndicator(raw: string): ParsedIndicator {
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid successIndicator format: "${raw}". Expected "url:<path>", "selector:<css>", or "text:<string>".`
    );
  }
  const type = raw.slice(0, colonIndex) as IndicatorType;
  const value = raw.slice(colonIndex + 1);

  if (!["url", "selector", "text"].includes(type)) {
    throw new Error(
      `Unknown successIndicator type: "${type}". Expected "url", "selector", or "text".`
    );
  }
  if (!value) {
    throw new Error(`Empty value in successIndicator: "${raw}".`);
  }
  return { type, value };
}

export async function waitForSuccess(
  page: StagehandPage,
  indicator: ParsedIndicator,
  timeoutMs: number = 30_000
): Promise<void> {
  const start = Date.now();

  const poll = async (): Promise<boolean> => {
    switch (indicator.type) {
      case "url": {
        const currentUrl = page.url();
        try {
          const url = new URL(currentUrl);
          return (
            url.pathname === indicator.value ||
            url.pathname.startsWith(indicator.value)
          );
        } catch {
          return currentUrl.includes(indicator.value);
        }
      }
      case "selector": {
        try {
          const el = page.locator(indicator.value);
          return (await el.count()) > 0;
        } catch {
          return false;
        }
      }
      case "text": {
        const content = await page.evaluate(
          () => document.body?.innerText ?? ""
        );
        return content.includes(indicator.value);
      }
    }
  };

  while (Date.now() - start < timeoutMs) {
    if (await poll()) return;
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `Authentication failed: success indicator "${indicator.type}:${indicator.value}" not detected within ${timeoutMs / 1000}s.`
  );
}
