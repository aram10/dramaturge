import type { Stagehand } from "@browserbasehq/stagehand";
import { createHash } from "node:crypto";
import type { PageFingerprint } from "../types.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

/**
 * Capture a deterministic fingerprint of the current page state.
 * Uses URL path, title, heading, and visible dialog titles to produce a hash.
 * Two pages with the same path but a different modal should produce different fingerprints.
 */
export async function captureFingerprint(
  page: StagehandPage
): Promise<PageFingerprint> {
  const url = page.url();
  let normalizedPath: string;
  try {
    normalizedPath = new URL(url).pathname;
  } catch {
    normalizedPath = url;
  }

  const { title, heading, dialogTitles } = await page.evaluate(() => {
    const title = document.title ?? "";
    const h1 = document.querySelector("h1");
    const heading = h1?.textContent?.trim() ?? "";
    const dialogs = Array.from(
      document.querySelectorAll(
        'dialog[open], [role="dialog"], [role="alertdialog"]'
      )
    );
    const dialogTitles = dialogs
      .map((d) => {
        const heading =
          d.querySelector("h1, h2, h3, [role='heading']");
        return heading?.textContent?.trim() ?? "";
      })
      .filter(Boolean);
    return { title, heading, dialogTitles };
  });

  const hashInput = [normalizedPath, title, heading, ...dialogTitles].join("|");
  const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, 12);

  return { normalizedPath, title, heading, dialogTitles, hash };
}

/**
 * Check if a fingerprint has already been seen.
 * Returns true if this is a duplicate (should be skipped).
 */
export function isDuplicateState(
  fingerprint: PageFingerprint,
  visited: Set<string>
): boolean {
  return visited.has(fingerprint.hash);
}

/**
 * Mark a fingerprint as visited.
 */
export function markVisited(
  fingerprint: PageFingerprint,
  visited: Set<string>
): void {
  visited.add(fingerprint.hash);
}
