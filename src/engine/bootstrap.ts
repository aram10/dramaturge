import { spawn, type ChildProcess } from 'node:child_process';
import type { Stagehand } from '@browserbasehq/stagehand';
import type { DramaturgeConfig } from '../config.js';

const BOOTSTRAP_LOG_LIMIT = 20;
const DEFAULT_READY_REQUEST_TIMEOUT_MS = 5_000;

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

type SpawnLike = typeof spawn;

export interface BootstrapStatus {
  process?: ChildProcess;
  command?: string;
  recentStdout: string[];
  recentStderr: string[];
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
}

interface WaitForBootstrapReadyDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  requestTimeoutMs?: number;
  newPage?: () => Promise<StagehandPage>;
}

function createBootstrapStatus(processRef?: ChildProcess, command?: string): BootstrapStatus {
  return {
    process: processRef,
    command,
    recentStdout: [],
    recentStderr: [],
    exited: false,
    exitCode: null,
    exitSignal: null,
  };
}

function appendLogLines(target: string[], chunk: string): void {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return;
  }

  target.push(...lines);
  if (target.length > BOOTSTRAP_LOG_LIMIT) {
    target.splice(0, target.length - BOOTSTRAP_LOG_LIMIT);
  }
}

function attachLogStream(stream: NodeJS.ReadableStream | null | undefined, target: string[]): void {
  if (!stream) {
    return;
  }

  stream.on('data', (chunk: Buffer | string) => {
    appendLogLines(target, chunk.toString());
  });
}

function formatBootstrapFailure(summary: string, status?: BootstrapStatus): string {
  const details: string[] = [summary];

  if (status?.command) {
    details.push(`command: ${status.command}`);
  }
  if (status?.exited) {
    details.push(`exit: code=${status.exitCode ?? 'null'} signal=${status.exitSignal ?? 'null'}`);
  }
  if ((status?.recentStdout.length ?? 0) > 0) {
    details.push(`stdout: ${status?.recentStdout.join(' | ')}`);
  }
  if ((status?.recentStderr.length ?? 0) > 0) {
    details.push(`stderr: ${status?.recentStderr.join(' | ')}`);
  }

  return details.join(' | ');
}

export function startBootstrapProcess(
  config: DramaturgeConfig,
  spawnImpl: SpawnLike = spawn
): BootstrapStatus | undefined {
  const command = config.bootstrap?.command;
  if (!command) {
    return undefined;
  }

  console.log(`Starting bootstrap command: ${command}`);
  const processRef = spawnImpl(command, {
    cwd: config.bootstrap?.cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const status = createBootstrapStatus(processRef, command);

  attachLogStream(processRef.stdout, status.recentStdout);
  attachLogStream(processRef.stderr, status.recentStderr);
  processRef.on('exit', (code, signal) => {
    status.exited = true;
    status.exitCode = code;
    status.exitSignal = signal;
  });

  return status;
}

async function isReadyUrlReachable(
  url: string,
  fetchImpl: typeof fetch,
  requestTimeoutMs: number
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: controller.signal,
    });
    return response.ok || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function hasReadyIndicator(
  newPage: () => Promise<StagehandPage>,
  pageUrl: string,
  selector: string
): Promise<boolean> {
  let readinessPage: StagehandPage | undefined;

  try {
    readinessPage = await newPage();
    await readinessPage.goto(pageUrl);
    const found = await readinessPage.evaluate(
      `() => Boolean(document.querySelector(${JSON.stringify(selector)}))`
    );
    return found === true;
  } catch {
    return false;
  } finally {
    await readinessPage?.close().catch(() => undefined);
  }
}

export async function waitForBootstrapReady(
  config: DramaturgeConfig,
  page: StagehandPage,
  status?: BootstrapStatus,
  deps: WaitForBootstrapReadyDeps = {}
): Promise<void> {
  if (!config.bootstrap) {
    return;
  }

  const readyUrl = config.bootstrap.readyUrl
    ? new URL(config.bootstrap.readyUrl, config.targetUrl).href
    : config.targetUrl;
  const readyIndicatorUrl = config.targetUrl;
  const readyIndicator = config.bootstrap.readyIndicator;

  if (!config.bootstrap.readyUrl && !readyIndicator) {
    return;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_READY_REQUEST_TIMEOUT_MS;
  const newPage = deps.newPage;
  const checkReadyIndicator =
    readyIndicator && newPage
      ? () => hasReadyIndicator(newPage, readyIndicatorUrl, readyIndicator)
      : undefined;

  if (readyIndicator && !checkReadyIndicator) {
    throw new Error('Bootstrap readyIndicator checks require a newPage factory in dependencies.');
  }

  const deadline = now() + config.bootstrap.timeoutSeconds * 1000;
  while (now() < deadline) {
    if (status?.exited) {
      throw new Error(formatBootstrapFailure('Bootstrap process exited before ready', status));
    }

    const urlReady =
      !config.bootstrap.readyUrl ||
      (await isReadyUrlReachable(readyUrl, fetchImpl, requestTimeoutMs));
    const indicatorReady = !checkReadyIndicator || (await checkReadyIndicator());

    if (urlReady && indicatorReady) {
      console.log('Bootstrap target is ready.');
      return;
    }

    await sleep(1000);
  }

  throw new Error(
    formatBootstrapFailure(
      `Bootstrap did not become ready within ${config.bootstrap.timeoutSeconds}s`,
      status
    )
  );
}

export function stopBootstrapProcess(
  status?: BootstrapStatus,
  spawnImpl: SpawnLike = spawn,
  platform = process.platform
): void {
  const processRef = status?.process;
  if (!processRef?.pid) {
    return;
  }

  if (platform === 'win32') {
    spawnImpl('taskkill', ['/pid', String(processRef.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    return;
  }

  processRef.kill?.('SIGTERM');
}
