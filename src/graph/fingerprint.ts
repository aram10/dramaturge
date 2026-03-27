import type { Stagehand } from "@browserbasehq/stagehand";
import { createHash } from "node:crypto";
import type { PageFingerprint } from "../types.js";
import { buildStateSignature, buildStateSignatureKey } from "./state-signature.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

/** Hash of URL path + title + heading + visible dialog titles (different modals → different fingerprints). */
export async function captureFingerprint(
  page: StagehandPage
): Promise<PageFingerprint> {
  const url = page.url();
  const { title, heading, dialogTitles, uiMarkers } = await page.evaluate(() => {
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
    const activeElements = Array.from(
      document.querySelectorAll(
        [
          '[aria-current="page"]',
          '[aria-current="step"]',
          '[role="tab"][aria-selected="true"]',
          '[role="option"][aria-selected="true"]',
          '[data-state="active"]',
          '[data-selected="true"]',
          '[aria-pressed="true"]',
          '[aria-sort]',
        ].join(", ")
      )
    );
    const uiMarkers = activeElements
      .map((element) => {
        const label =
          element.getAttribute("data-testid") ??
          element.getAttribute("id") ??
          element.getAttribute("aria-label") ??
          element.getAttribute("name") ??
          element.getAttribute("href") ??
          element.textContent?.trim() ??
          element.tagName.toLowerCase();
        return label?.trim() ?? "";
      })
      .filter(Boolean);

    return { title, heading, dialogTitles, uiMarkers };
  });

  const signature = buildStateSignature(url, uiMarkers);
  const normalizedPath = signature.pathname;
  const hashInput = [
    buildStateSignatureKey(signature),
    title,
    heading,
    ...dialogTitles,
  ].join("|");
  const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, 12);

  return { normalizedPath, signature, title, heading, dialogTitles, hash };
}

export function isDuplicateState(
  fingerprint: PageFingerprint,
  visited: Set<string>
): boolean {
  return visited.has(fingerprint.hash);
}

export function markVisited(
  fingerprint: PageFingerprint,
  visited: Set<string>
): void {
  visited.add(fingerprint.hash);
}
