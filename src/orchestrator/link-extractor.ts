import type { Stagehand } from "@browserbasehq/stagehand";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface ExtractedLink {
  url: string;
  text: string;
}

const IGNORED_SCHEMES = ["javascript:", "mailto:", "tel:", "blob:", "data:"];

export function isNavigationLink(href: string, baseUrl: string): boolean {
  const trimmed = href.trim();

  if (!trimmed || trimmed.startsWith("#")) return false;
  if (IGNORED_SCHEMES.some((s) => trimmed.toLowerCase().startsWith(s)))
    return false;

  try {
    const resolved = new URL(trimmed, baseUrl);
    const base = new URL(baseUrl);
    return resolved.origin === base.origin;
  } catch {
    return false;
  }
}

export function deduplicateLinks(links: ExtractedLink[]): ExtractedLink[] {
  const seen = new Set<string>();
  const result: ExtractedLink[] = [];

  for (const link of links) {
    try {
      const url = new URL(link.url);
      const key = url.pathname.replace(/\/+$/, "") || "/";
      if (!seen.has(key)) {
        seen.add(key);
        result.push(link);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  return result;
}

/**
 * Extract all `<a href>` links from the current page via DOM evaluation.
 * Returns only same-origin, non-anchor, non-javascript links.
 */
export async function extractPageLinks(
  page: StagehandPage,
  baseUrl: string,
): Promise<ExtractedLink[]> {
  const raw: Array<{ href: string; text: string }> = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a.textContent ?? "").trim().slice(0, 100),
    })),
  );

  return deduplicateLinks(
    raw
      .filter((r) => isNavigationLink(r.href, baseUrl))
      .map((r) => ({ url: r.href, text: r.text || "Untitled link" })),
  );
}
