// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

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
  // Use allSettled so that a single worker that fails to initialize does not
  // orphan the browser instances that already launched successfully. Any
  // started instances are closed before the aggregated error is rethrown.
  const results = await Promise.allSettled(
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

  const sessions: WorkerSession[] = [];
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      sessions.push(result.value);
    } else {
      failures.push(result.reason);
    }
  }

  if (failures.length > 0) {
    await closeWorkerPool(sessions);
    const messages = failures.map((reason) =>
      reason instanceof Error ? reason.message : String(reason)
    );
    const summary =
      failures.length === 1
        ? messages[0]
        : `${failures.length} worker(s) failed to initialize: ${messages.join('; ')}`;
    const aggregated = new Error(summary);
    // Preserve the first underlying error for debugging via the standard cause chain.
    if (failures[0] instanceof Error) {
      aggregated.cause = failures[0];
    }
    throw aggregated;
  }

  return sessions;
}

export async function closeWorkerPool(pool: WorkerSession[]): Promise<void> {
  for (const worker of pool) {
    try {
      // Close the whole Stagehand instance (browser + context), not just the
      // context, so the underlying browser process is not left running.
      await worker.stagehand.close();
    } catch (error) {
      console.warn(
        `Worker pool cleanup error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
