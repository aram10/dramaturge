import { Stagehand } from "@browserbasehq/stagehand";
import type { WebProbeConfig } from "../config.js";
import { authenticate } from "../auth/authenticator.js";
import type { BrowserErrorCollector } from "../browser-errors.js";

export async function initWorkerPool(
  config: WebProbeConfig,
  count: number,
  errorCollector: BrowserErrorCollector
): Promise<Stagehand[]> {
  if (count <= 0) return [];
  const pool: Stagehand[] = [];
  for (let i = 0; i < count; i++) {
    const sh = new Stagehand({
      env: "LOCAL",
      model: config.models.planner,
      localBrowserLaunchOptions: { headless: false },
      verbose: 0,
    });
    await sh.init();
    await authenticate(sh, config);
    errorCollector.attach(sh.context.pages()[0]);
    pool.push(sh);
  }
  return pool;
}

export async function closeWorkerPool(pool: Stagehand[]): Promise<void> {
  for (const sh of pool) {
    try { await sh.context.close(); } catch { /* best-effort */ }
  }
}
