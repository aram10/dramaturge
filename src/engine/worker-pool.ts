import { Stagehand } from "@browserbasehq/stagehand";
import type { WebProbeConfig } from "../config.js";
import { authenticate } from "../auth/authenticator.js";
import type { BrowserErrorCollector } from "../browser-errors.js";

export interface WorkerSession {
  key: string;
  stagehand: Stagehand;
  page: ReturnType<Stagehand["context"]["pages"]>[number];
}

export function createStagehand(config: WebProbeConfig): Stagehand {
  return new Stagehand({
    env: "LOCAL",
    model: config.models.planner,
    localBrowserLaunchOptions: { headless: false },
    verbose: 0,
  });
}

export async function initWorkerPool(
  config: WebProbeConfig,
  count: number,
  errorCollector: BrowserErrorCollector
): Promise<WorkerSession[]> {
  if (count <= 0) return [];
  const pool: WorkerSession[] = [];
  for (let i = 0; i < count; i++) {
    const sh = createStagehand(config);
    await sh.init();
    await authenticate(sh, config);
    const key = `worker-${i + 1}`;
    const page = sh.context.pages()[0];
    errorCollector.attach(page, key);
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
