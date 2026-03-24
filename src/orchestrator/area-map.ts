import type { Area } from "../types.js";

/**
 * Deduplicate areas by URL (preferred) or name similarity.
 * Keeps the first occurrence when duplicates are found.
 */
export function deduplicateAreas(areas: Area[]): Area[] {
  const seen = new Map<string, Area>();

  for (const area of areas) {
    // Normalize key: prefer URL path, fall back to lowercase name
    const key = area.url
      ? new URL(area.url, "http://placeholder").pathname
      : area.name.toLowerCase().trim();

    if (!seen.has(key)) {
      seen.set(key, area);
    }
  }

  return Array.from(seen.values());
}

/**
 * Convert Stagehand observe() Action results into Area objects.
 * Extracts URLs from href attributes when available.
 */
export function actionsToAreas(
  actions: Array<{
    selector: string;
    description: string;
    method?: string;
    arguments?: string[];
  }>,
  baseUrl: string
): Area[] {
  return actions
    .filter((a) => {
      // Keep only navigation-like actions
      const desc = a.description.toLowerCase();
      return (
        a.method === "click" ||
        desc.includes("navigate") ||
        desc.includes("link") ||
        desc.includes("menu") ||
        desc.includes("tab") ||
        desc.includes("page") ||
        desc.includes("section")
      );
    })
    .map((action) => {
      // Try to extract URL from arguments (href)
      const hrefArg = action.arguments?.find(
        (arg) => arg.startsWith("/") || arg.startsWith("http")
      );

      return {
        name: action.description,
        url: hrefArg ? new URL(hrefArg, baseUrl).href : undefined,
        selector: action.selector,
        description: action.description,
      };
    });
}
