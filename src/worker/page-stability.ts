import type { Stagehand } from '@browserbasehq/stagehand';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

/** Builds a browser-eval script that resolves once DOM mutations quiet for 300ms (or timeout). */
export function buildStabilityChecker(timeoutMs = 5000): string {
  return `
    () => new Promise((resolve) => {
      const QUIET_MS = 300;
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
        attributes: true,
      });

      // Start the quiet timer immediately (page may already be stable)
      timer = setTimeout(() => done("stable"), QUIET_MS);
    })
  `.trim();
}

/** Wait for the page DOM to settle; returns "stable" or "timeout". */
export async function waitForPageStable(
  page: StagehandPage,
  timeoutMs = 5000
): Promise<'stable' | 'timeout'> {
  try {
    const result = await Promise.race([
      page.evaluate(buildStabilityChecker(timeoutMs)) as Promise<string>,
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs + 1000)),
    ]);
    return result === 'stable' ? 'stable' : 'timeout';
  } catch {
    return 'timeout';
  }
}
