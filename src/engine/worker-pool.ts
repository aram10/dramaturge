import { Stagehand } from "@browserbasehq/stagehand";
import type { DramaturgeConfig } from "../config.js";
import { authenticate } from "../auth/authenticator.js";
import type { BrowserErrorCollector } from "../browser-errors.js";
import { applyStorageState, type BrowserStorageState } from "../auth/storage-state.js";
import type { NetworkTrafficObserver } from "../network/traffic-observer.js";

export interface WorkerSession {
  key: string;
  stagehand: Stagehand;
  page: ReturnType<Stagehand["context"]["pages"]>[number];
}

export function createStagehand(config: DramaturgeConfig): Stagehand {
  return new Stagehand({
    env: "LOCAL",
    model: config.models.planner,
    localBrowserLaunchOptions: { headless: config.browser?.headless ?? false },
    verbose: 0,
  });
}

export async function initWorkerPool(
  config: DramaturgeConfig,
  count: number,
  errorCollector: BrowserErrorCollector,
  trafficObserver?: NetworkTrafficObserver,
  sharedState?: BrowserStorageState
): Promise<WorkerSession[]> {
  if (count <= 0) return [];
  const pool: WorkerSession[] = [];
  for (let i = 0; i < count; i++) {
    const sh = createStagehand(config);
    await sh.init();
    if (sharedState) {
      await applyStorageState(sh, config.targetUrl, sharedState);
    } else {
      await authenticate(sh, config);
    }
    const key = `worker-${i + 1}`;
    const page = sh.context.pages()[0];
    errorCollector.attach(page, key);
    trafficObserver?.attach(page, key);
    pool.push({ key, stagehand: sh, page });
  }
  return pool;
}

export async function closeWorkerPool(pool: WorkerSession[]): Promise<void> {
  for (const worker of pool) {
    try { await worker.stagehand.context.close(); } catch (error) {
      console.warn(`Worker pool cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
