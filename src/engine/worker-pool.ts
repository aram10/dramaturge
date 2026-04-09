import { Stagehand } from '@browserbasehq/stagehand';
import { resolveBrowserOpsModel, type DramaturgeConfig } from '../config.js';
import { authenticate } from '../auth/authenticator.js';
import type { BrowserErrorCollector } from '../browser-errors.js';
import { applyStorageState, type BrowserStorageState } from '../auth/storage-state.js';
import { adaptStagehand } from '../browser/page-interface.js';
import type { NetworkTrafficObserver } from '../network/traffic-observer.js';

export interface WorkerSession {
  key: string;
  stagehand: Stagehand;
  page: ReturnType<Stagehand['context']['pages']>[number];
}

export function createStagehand(config: DramaturgeConfig): Stagehand {
  return new Stagehand({
    env: 'LOCAL',
    model: resolveBrowserOpsModel(config),
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
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const sh = createStagehand(config);
      await sh.init();
      if (sharedState) {
        await applyStorageState(adaptStagehand(sh), config.targetUrl, sharedState);
      } else {
        await authenticate(sh, config);
      }
      const key = `worker-${index + 1}`;
      const page = sh.context.pages()[0];
      errorCollector.attach(page, key);
      trafficObserver?.attach(page, key);
      return { key, stagehand: sh, page };
    })
  );
}

export async function closeWorkerPool(pool: WorkerSession[]): Promise<void> {
  for (const worker of pool) {
    try {
      await worker.stagehand.context.close();
    } catch (error) {
      console.warn(
        `Worker pool cleanup error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
