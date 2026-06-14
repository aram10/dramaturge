// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { ConsoleMessage, Page, Request, Response } from 'playwright';
import type { BrowserAgent } from '../browser/agent.js';
import { createStagehandAgent, StagehandBrowserAgent } from '../browser/stagehand-agent.js';
import { authenticate } from '../auth/authenticator.js';
import type { DramaturgeConfig } from '../config.js';
import type { ReplayableAction } from '../types.js';
import type { FindingReplayManifest } from './manifest.js';
import type { CurrentOracleObservation, ManifestReplayResult, ReplayAdapter } from './replayer.js';
import { REPLAY_SETTLE_TIMEOUT_MS, DEFAULT_NETWORK_ERROR_MIN_STATUS } from '../constants.js';

export interface LiveReplayOptions {
  config?: DramaturgeConfig;
  profile?: string;
  createBrowserAgent?: () => BrowserAgent;
  authenticateBrowser?: (
    agent: BrowserAgent,
    config: DramaturgeConfig,
    profile?: string
  ) => Promise<void>;
}

function replayTargetUrl(manifest: FindingReplayManifest, config?: DramaturgeConfig): string {
  const baseUrl = config?.targetUrl ?? manifest.origin.targetUrl;
  if (!manifest.origin.route) return baseUrl;
  return new URL(manifest.origin.route, baseUrl).href;
}

function actionTarget(action: ReplayableAction): string | undefined {
  return action.selector ?? action.url;
}

function blockedStep(
  action: ReplayableAction,
  summary: string
): ManifestReplayResult['stepOutcomes'][number] {
  return {
    actionId: action.id,
    status: 'blocked',
    summary,
  };
}

async function settlePage(page: Page): Promise<void> {
  await page
    .waitForLoadState('networkidle', { timeout: REPLAY_SETTLE_TIMEOUT_MS })
    .catch(() => undefined);
}

async function replayAction(page: Page, action: ReplayableAction): Promise<void> {
  switch (action.kind) {
    case 'navigate':
      await page.goto(action.url ?? page.url(), { waitUntil: 'domcontentloaded' });
      return;
    case 'click':
    case 'submit':
    case 'open':
    case 'close':
    case 'toggle':
      if (!action.selector) throw new Error(`${action.kind} action is missing a selector`);
      await page.locator(action.selector).click();
      return;
    case 'input':
      if (!action.selector) throw new Error('input action is missing a selector');
      if (action.redacted || action.value === undefined) {
        throw new Error('input action value was redacted and cannot be replayed');
      }
      await page.locator(action.selector).fill(action.value);
      return;
    case 'keydown':
      if (!action.key) throw new Error('keydown action is missing a key');
      if (action.selector) {
        await page.locator(action.selector).press(action.key);
        return;
      }
      await page.keyboard.press(action.key);
      return;
    case 'screenshot':
      await page.screenshot({ fullPage: true });
      return;
    case 'discover-edge':
      return;
  }
}

function attachOracleCollectors(
  manifest: FindingReplayManifest,
  page: Page,
  networkErrorMinStatus = DEFAULT_NETWORK_ERROR_MIN_STATUS
): { observed: CurrentOracleObservation; detach: () => void } {
  const observed: CurrentOracleObservation = {
    consoleErrors: [],
    networkFailures: [],
    a11yRuleIds: [],
  };

  const consoleFragments = manifest.oracles.consoleErrorFragments ?? [];
  const networkFailures = manifest.oracles.networkFailures ?? [];
  const matchesConsoleOracle = (text: string) =>
    consoleFragments.some((fragment) => text.includes(fragment));
  const matchesNetworkOracle = (url: string, status: number) =>
    networkFailures.some(
      (failure) => status === failure.status && url.includes(failure.urlPattern)
    );

  const onConsole = (message: ConsoleMessage) => {
    const text = message.text();
    if (message.type() === 'error' && (matchesConsoleOracle(text) || consoleFragments.length > 0)) {
      observed.consoleErrors.push(text);
    }
  };
  const onPageError = (error: Error) => {
    if (matchesConsoleOracle(error.message) || consoleFragments.length > 0) {
      observed.consoleErrors.push(error.message);
    }
  };
  const onResponse = (response: Response) => {
    const status = response.status();
    const url = response.url();
    if (
      matchesNetworkOracle(url, status) ||
      (status >= networkErrorMinStatus && networkFailures.length > 0)
    ) {
      observed.networkFailures.push({ url: response.url(), status });
    }
  };
  const onRequestFailed = (request: Request) => {
    if (matchesNetworkOracle(request.url(), 0) || networkFailures.length > 0) {
      observed.networkFailures.push({ url: request.url(), status: 0 });
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    observed,
    detach: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

function firstPage(agent: BrowserAgent): Page {
  const page = agent.context.pages()[0];
  if (!page) {
    throw new Error('Live replay could not start because no browser page was available.');
  }
  return page;
}

async function defaultAuthenticateBrowser(
  agent: BrowserAgent,
  config: DramaturgeConfig,
  profile?: string
): Promise<void> {
  if (!(agent instanceof StagehandBrowserAgent)) {
    throw new Error('Configured auth requires a Stagehand browser agent.');
  }
  await authenticate(agent.getStagehand(), config, profile);
}

export function createLiveReplayAdapter(options: LiveReplayOptions = {}): ReplayAdapter {
  return {
    replay: async (manifest) => {
      const startedAt = Date.now();
      const agent = options.createBrowserAgent?.() ?? createStagehandAgent();
      try {
        await agent.init({
          headless: options.config?.browser.headless ?? true,
          modelName: options.config?.models.browserOps ?? options.config?.models.planner,
          verbose: 0,
        });

        if (options.config) {
          await (options.authenticateBrowser ?? defaultAuthenticateBrowser)(
            agent,
            options.config,
            options.profile ?? manifest.origin.authProfile
          );
        }

        const page = firstPage(agent);
        const targetUrl = replayTargetUrl(manifest, options.config);
        const { observed, detach } = attachOracleCollectors(
          manifest,
          page,
          options.config?.autoCapture.networkErrorMinStatus
        );
        const stepOutcomes: ManifestReplayResult['stepOutcomes'] = [];
        try {
          if (page.url() !== targetUrl) {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          }

          for (const action of manifest.replay.actions) {
            try {
              await replayAction(page, action);
              await settlePage(page);
              stepOutcomes.push({
                actionId: action.id,
                status: 'worked',
                summary: `${action.summary} (replayed)`,
              });
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              stepOutcomes.push(
                blockedStep(action, `${actionTarget(action) ?? action.kind}: ${reason}`)
              );
              break;
            }
          }
        } finally {
          detach();
        }

        const screenshot = await page.screenshot({ fullPage: true }).catch(() => undefined);
        return {
          stepOutcomes,
          observed,
          evidence: {
            consoleErrors: observed.consoleErrors,
            ...(screenshot ? { screenshotRef: `inline:${screenshot.length} bytes` } : {}),
          },
          durationMs: Date.now() - startedAt,
          ...(stepOutcomes.some((step) => step.status === 'blocked')
            ? { stoppedReason: stepOutcomes.find((step) => step.status === 'blocked')?.summary }
            : {}),
        };
      } finally {
        await agent.close();
      }
    },
  };
}
