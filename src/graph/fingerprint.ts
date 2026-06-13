// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import { createHash } from 'node:crypto';
import type { PageFingerprint } from '../types.js';
import { buildStateSignature, buildStateSignatureKey } from './state-signature.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

/** Hash of URL path + title + heading + visible dialog titles (different modals → different fingerprints). */
export async function captureFingerprint(page: StagehandPage): Promise<PageFingerprint> {
  const url = page.url();
  const { title, heading, dialogTitles, uiMarkers } = await page.evaluate(() => {
    const title = document.title ?? '';
    const h1 = document.querySelector('h1');
    const heading = h1?.textContent?.trim() ?? '';
    const dialogs = Array.from(
      document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]')
    );
    const dialogTitles = dialogs
      .map((d) => {
        const heading = d.querySelector("h1, h2, h3, [role='heading']");
        return heading?.textContent?.trim() ?? '';
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
        ].join(', ')
      )
    );
    const uiMarkers = activeElements
      .map((element) => {
        const label =
          element.getAttribute('data-testid') ??
          element.getAttribute('id') ??
          element.getAttribute('aria-label') ??
          element.getAttribute('name') ??
          element.getAttribute('href') ??
          element.textContent?.trim() ??
          element.tagName.toLowerCase();
        return label?.trim() ?? '';
      })
      .filter(Boolean);

    return { title, heading, dialogTitles, uiMarkers };
  });

  const signature = buildStateSignature(url, uiMarkers);
  const normalizedPath = signature.pathname;
  // Strip volatile numeric runs from the title/heading before hashing so dynamic
  // counters ('Inbox (3)') don't fragment a page into a new node per visit (#219).
  const stableTitle = stripVolatileCounters(title);
  const stableHeading = stripVolatileCounters(heading);
  const hashInput = [
    buildStateSignatureKey(signature),
    stableTitle,
    stableHeading,
    ...dialogTitles,
  ].join('|');
  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 12);

  return { normalizedPath, signature, title, heading, dialogTitles, hash };
}

/** Replace runs of digits with a placeholder so counters don't destabilize hashes. */
function stripVolatileCounters(value: string): string {
  return value.replace(/\d+/g, '#');
}

export function isDuplicateState(fingerprint: PageFingerprint, visited: Set<string>): boolean {
  return visited.has(fingerprint.hash);
}

export function markVisited(fingerprint: PageFingerprint, visited: Set<string>): void {
  visited.add(fingerprint.hash);
}
