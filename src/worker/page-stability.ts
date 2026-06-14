// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import { PAGE_STABILITY_TIMEOUT_MS, DOM_QUIET_MS, PAGE_STABILITY_BUFFER_MS } from '../constants.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

/** Builds a browser-eval script that resolves once DOM mutations quiet for 300ms (or timeout). */
export function buildStabilityChecker(timeoutMs = PAGE_STABILITY_TIMEOUT_MS): string {
  return `
    () => new Promise((resolve) => {
      const QUIET_MS = ${DOM_QUIET_MS};
      const TIMEOUT_MS = ${timeoutMs};
      let timer;
      let settled = false;

      const done = (reason) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        resolve(reason);
      };

      // Timeout fallback
      setTimeout(() => done("timeout"), TIMEOUT_MS);

      // Watch for DOM quiet
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => done("stable"), QUIET_MS);
      });

      observer.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: false,
      });

      // Start the quiet timer immediately (page may already be stable)
      timer = setTimeout(() => done("stable"), QUIET_MS);
    })
  `.trim();
}

/** Wait for the page DOM to settle; returns "stable" or "timeout". */
export async function waitForPageStable(
  page: StagehandPage,
  timeoutMs = PAGE_STABILITY_TIMEOUT_MS
): Promise<'stable' | 'timeout'> {
  try {
    const result = await Promise.race([
      page.evaluate(buildStabilityChecker(timeoutMs)) as Promise<string>,
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('timeout'), timeoutMs + PAGE_STABILITY_BUFFER_MS)
      ),
    ]);
    return result === 'stable' ? 'stable' : 'timeout';
  } catch {
    return 'timeout';
  }
}
