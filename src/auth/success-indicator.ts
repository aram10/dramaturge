import type { Stagehand } from '@browserbasehq/stagehand';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

export type IndicatorType = 'url' | 'selector' | 'text';
export type UrlMatchMode = 'exact' | 'prefix';

export interface ParsedIndicator {
  type: IndicatorType;
  value: string;
  match?: UrlMatchMode;
}

export function parseIndicator(raw: string): ParsedIndicator {
  const colonIndex = raw.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(
      `Invalid successIndicator format: "${raw}". Expected "url:<path>", "url-prefix:<path>", "selector:<css>", or "text:<string>".`
    );
  }
  const rawType = raw.slice(0, colonIndex);
  const value = raw.slice(colonIndex + 1);

  if (!['url', 'url-prefix', 'selector', 'text'].includes(rawType)) {
    throw new Error(
      `Unknown successIndicator type: "${rawType}". Expected "url", "url-prefix", "selector", or "text".`
    );
  }
  if (!value) {
    throw new Error(`Empty value in successIndicator: "${raw}".`);
  }
  if (rawType === 'url-prefix') {
    return { type: 'url', value, match: 'prefix' };
  }
  if (rawType === 'url') {
    return { type: 'url', value, match: 'exact' };
  }
  return { type: rawType as IndicatorType, value };
}

export function matchesUrlIndicator(currentUrl: string, indicator: ParsedIndicator): boolean {
  if (indicator.type !== 'url') {
    return false;
  }

  try {
    const url = new URL(currentUrl);
    if (indicator.match === 'prefix') {
      return url.pathname.startsWith(indicator.value);
    }
    return url.pathname === indicator.value;
  } catch {
    if (indicator.match === 'prefix') {
      return currentUrl.includes(indicator.value);
    }
    return currentUrl === indicator.value;
  }
}

export async function waitForSuccess(
  page: StagehandPage,
  indicator: ParsedIndicator,
  timeoutMs: number = 30_000
): Promise<void> {
  const start = Date.now();

  const poll = async (): Promise<boolean> => {
    switch (indicator.type) {
      case 'url': {
        return matchesUrlIndicator(page.url(), indicator);
      }
      case 'selector': {
        try {
          const el = page.locator(indicator.value);
          return (await el.count()) > 0;
        } catch {
          return false;
        }
      }
      case 'text': {
        const content = await page.evaluate(() => document.body?.innerText ?? '');
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
