// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import type { BrowserAgent } from '../browser/agent.js';
import type { DramaturgeConfig } from '../config.js';
import type { ReplayableAction } from '../types.js';
import type { FindingReplayManifest } from './manifest.js';
import { confirmManifest } from './replayer.js';
import { createLiveReplayAdapter } from './live-replay.js';

type PageEventName = 'console' | 'pageerror' | 'response' | 'requestfailed';
type PageEventHandler = (value: unknown) => void;

interface FakePageHarness {
  page: Page;
  calls: {
    close: number;
    click: string[];
    fill: Array<{ selector: string; value: string }>;
    goto: string[];
    init: number;
    keyPress: string[];
    screenshot: number;
  };
}

function makeAction(overrides: Partial<ReplayableAction> = {}): ReplayableAction {
  return {
    id: 'act-1',
    kind: 'click',
    summary: 'Click submit',
    source: 'page',
    status: 'recorded',
    timestamp: '2026-05-20T18:00:01.000Z',
    selector: 'button[type="submit"]',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<FindingReplayManifest> = {}): FindingReplayManifest {
  return {
    schemaVersion: 1,
    finding: {
      id: 'BUG-0001',
      signature: '["Bug","Major","Submit fails","ok","bad"]',
      category: 'Bug',
      severity: 'Major',
      title: 'Submit fails',
      expected: 'ok',
      actual: 'bad',
      evidenceTypes: ['console-error'],
    },
    origin: {
      runStartedAt: '2026-05-20T18:00:00.000Z',
      targetUrl: 'https://example.com/app',
      route: '/checkout',
    },
    replay: {
      actions: [makeAction()],
      breadcrumbs: ['checkout'],
      objective: 'Submit checkout',
      maxStepsBudget: 1,
    },
    oracles: { consoleErrorFragments: ['Cannot read properties of null'] },
    ...overrides,
  };
}

function makeFakeBrowserAgent(
  harness: FakePageHarness,
  overrides: Partial<BrowserAgent> = {}
): BrowserAgent {
  return {
    context: {
      pages: () => [harness.page],
    },
    init: async () => {
      harness.calls.init += 1;
    },
    agent: () => ({
      execute: async () => ({ success: true }),
    }),
    close: async () => {
      harness.calls.close += 1;
    },
    ...overrides,
  };
}

function makeFakePage(
  options: {
    consoleOnClick?: string;
    failClick?: boolean;
    initialUrl?: string;
    pageErrorOnClick?: string;
    requestFailedOnClick?: string;
    responseOnClick?: { url: string; status: number };
    screenshotFails?: boolean;
  } = {}
): FakePageHarness {
  let currentUrl = options.initialUrl ?? 'about:blank';
  const handlers = new Map<PageEventName, PageEventHandler[]>();
  const calls: FakePageHarness['calls'] = {
    close: 0,
    click: [],
    fill: [],
    goto: [],
    init: 0,
    keyPress: [],
    screenshot: 0,
  };
  const emit = (eventName: PageEventName, value: unknown) => {
    for (const handler of handlers.get(eventName) ?? []) {
      handler(value);
    }
  };
  const page = {
    goto: async (url: string) => {
      currentUrl = url;
      calls.goto.push(url);
    },
    keyboard: {
      press: async (key: string) => {
        calls.keyPress.push(key);
      },
    },
    locator: (selector: string) => ({
      click: async () => {
        calls.click.push(selector);
        if (options.failClick) {
          throw new Error('selector not found');
        }
        if (options.consoleOnClick) {
          emit('console', {
            type: () => 'error',
            text: () => options.consoleOnClick,
          });
        }
        if (options.pageErrorOnClick) {
          emit('pageerror', new Error(options.pageErrorOnClick));
        }
        if (options.responseOnClick) {
          emit('response', {
            status: () => options.responseOnClick?.status ?? 200,
            url: () => options.responseOnClick?.url ?? '',
          });
        }
        if (options.requestFailedOnClick) {
          emit('requestfailed', {
            url: () => options.requestFailedOnClick,
          });
        }
      },
      fill: async (value: string) => {
        calls.fill.push({ selector, value });
      },
      press: async (key: string) => {
        calls.keyPress.push(`${selector}:${key}`);
      },
    }),
    off: (eventName: PageEventName, handler: PageEventHandler) => {
      handlers.set(
        eventName,
        (handlers.get(eventName) ?? []).filter((candidate) => candidate !== handler)
      );
    },
    on: (eventName: PageEventName, handler: PageEventHandler) => {
      handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
    },
    screenshot: async () => {
      calls.screenshot += 1;
      if (options.screenshotFails) {
        throw new Error('screenshot failed');
      }
      return Buffer.from('png');
    },
    url: () => currentUrl,
    waitForLoadState: async () => undefined,
  };

  return {
    page: page as unknown as Page,
    calls,
  };
}

describe('createLiveReplayAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns fixed after replaying all actions when original oracles are not observed', async () => {
    const harness = makeFakePage();
    const manifest = makeManifest();
    const result = await confirmManifest(
      manifest,
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('fixed');
    expect(result.replay).toMatchObject({ actionsRequested: 1, actionsCompleted: 1 });
    expect(harness.calls.goto).toEqual(['https://example.com/checkout']);
    expect(harness.calls.click).toEqual(['button[type="submit"]']);
    expect(harness.calls.close).toBe(1);
  });

  it('replays navigation, input, keydown, screenshots, and discovery no-ops', async () => {
    const harness = makeFakePage();
    const manifest = makeManifest({
      replay: {
        actions: [
          makeAction({
            id: 'act-nav',
            kind: 'navigate',
            summary: 'Navigate to checkout step 2',
            url: 'https://example.com/checkout?step=2',
          }),
          makeAction({
            id: 'act-input',
            kind: 'input',
            summary: 'Fill email',
            selector: 'input[name="email"]',
            value: 'user@example.com',
          }),
          makeAction({
            id: 'act-key',
            kind: 'keydown',
            summary: 'Press enter',
            key: 'Enter',
            selector: undefined,
          }),
          makeAction({ id: 'act-shot', kind: 'screenshot', summary: 'Capture state' }),
          makeAction({ id: 'act-edge', kind: 'discover-edge', summary: 'Discover edge' }),
        ],
        breadcrumbs: ['checkout'],
        objective: 'Submit checkout',
        maxStepsBudget: 5,
      },
    });

    const result = await confirmManifest(
      manifest,
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('fixed');
    expect(result.replay.actionsCompleted).toBe(5);
    expect(harness.calls.goto).toEqual([
      'https://example.com/checkout',
      'https://example.com/checkout?step=2',
    ]);
    expect(harness.calls.fill).toEqual([
      { selector: 'input[name="email"]', value: 'user@example.com' },
    ]);
    expect(harness.calls.keyPress).toEqual(['Enter']);
    expect(harness.calls.screenshot).toBe(2);
  });

  it('returns still_reproducible when live replay observes the original console oracle', async () => {
    const harness = makeFakePage({
      consoleOnClick: 'Cannot read properties of null at checkout.js:12',
    });
    const manifest = makeManifest({
      oracles: { consoleErrorFragments: ['Cannot read properties of null'] },
    });
    const result = await confirmManifest(
      manifest,
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('still_reproducible');
    expect(result.oracleComparison.consoleErrorsCurrent).toBe(1);
  });

  it('returns cannot_confirm when a recorded action cannot be replayed', async () => {
    const harness = makeFakePage({ failClick: true });
    const result = await confirmManifest(
      makeManifest(),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('cannot_confirm');
    expect(result.replay.actionsCompleted).toBe(0);
    expect(result.replay.stoppedReason).toContain('selector not found');
    expect(harness.calls.close).toBe(1);
  });

  it('returns cannot_confirm for redacted input values', async () => {
    const harness = makeFakePage();
    const result = await confirmManifest(
      makeManifest({
        replay: {
          actions: [
            makeAction({
              kind: 'input',
              selector: 'input[type="password"]',
              summary: 'Fill password',
              redacted: true,
              value: undefined,
            }),
          ],
          breadcrumbs: [],
          objective: 'Submit login',
          maxStepsBudget: 1,
        },
      }),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('cannot_confirm');
    expect(result.replay.stoppedReason).toContain('redacted');
    expect(harness.calls.fill).toEqual([]);
  });

  it('closes the browser agent when initialization fails', async () => {
    const harness = makeFakePage();
    const initError = new Error('browser failed to start');

    const adapter = createLiveReplayAdapter({
      createBrowserAgent: () =>
        makeFakeBrowserAgent(harness, {
          init: async () => {
            harness.calls.init += 1;
            throw initError;
          },
        }),
    });

    await expect(adapter.replay(makeManifest())).rejects.toThrow('browser failed to start');
    expect(harness.calls.close).toBe(1);
  });

  it('captures network and page-error oracles during live replay', async () => {
    const harness = makeFakePage({
      pageErrorOnClick: 'checkout exploded',
      responseOnClick: { url: 'https://example.com/api/orders', status: 500 },
    });
    const result = await confirmManifest(
      makeManifest({
        oracles: {
          consoleErrorFragments: ['checkout exploded'],
          networkFailures: [{ urlPattern: '/api/orders', status: 500 }],
        },
      }),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('still_reproducible');
    expect(result.oracleComparison.consoleErrorsCurrent).toBe(1);
    expect(result.oracleComparison.networkFailuresCurrent).toBe(1);
  });

  it('returns new_related_issue for a different failure of the original oracle type', async () => {
    const harness = makeFakePage({
      consoleOnClick: 'Different checkout failure',
    });
    const result = await confirmManifest(
      makeManifest({
        oracles: { consoleErrorFragments: ['Cannot read properties of null'] },
      }),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('new_related_issue');
    expect(result.oracleComparison.consoleErrorsCurrent).toBe(1);
  });

  it('captures exact network oracle matches even below the configured noise threshold', async () => {
    const harness = makeFakePage({
      responseOnClick: { url: 'https://example.com/api/orders/42', status: 404 },
    });
    const config = {
      targetUrl: 'https://example.com/app',
      autoCapture: { networkErrorMinStatus: 500 },
      browser: { headless: true },
      models: { planner: 'anthropic/claude-sonnet-4-6' },
    } as DramaturgeConfig;

    const result = await confirmManifest(
      makeManifest({
        oracles: { networkFailures: [{ urlPattern: '/api/orders', status: 404 }] },
      }),
      createLiveReplayAdapter({
        authenticateBrowser: vi.fn().mockResolvedValue(undefined),
        config,
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('still_reproducible');
    expect(result.oracleComparison.networkFailuresCurrent).toBe(1);
  });

  it('captures matching request-failure oracles', async () => {
    const harness = makeFakePage({
      requestFailedOnClick: 'https://example.com/api/orders',
    });
    const result = await confirmManifest(
      makeManifest({
        oracles: {
          networkFailures: [{ urlPattern: '/api/orders', status: 0 }],
        },
      }),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('still_reproducible');
    expect(result.oracleComparison.networkFailuresCurrent).toBe(1);
  });

  it('ignores unrelated runtime noise but cannot confirm without an oracle (#209)', async () => {
    const harness = makeFakePage({
      consoleOnClick: 'unrelated ad script error',
      requestFailedOnClick: 'https://example.com/ad.js',
      screenshotFails: true,
    });
    const result = await confirmManifest(
      makeManifest({ oracles: {} }),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('cannot_confirm');
    expect(result.oracleComparison.consoleErrorsCurrent).toBe(0);
    expect(result.oracleComparison.networkFailuresCurrent).toBe(0);
    expect(result.evidence.screenshotRef).toBeUndefined();
  });

  it('skips the initial navigation when the page is already at the replay target', async () => {
    const harness = makeFakePage({ initialUrl: 'https://example.com/checkout' });
    const result = await confirmManifest(
      makeManifest(),
      createLiveReplayAdapter({
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(result.verdict).toBe('fixed');
    expect(harness.calls.goto).toEqual([]);
  });

  it('authenticates with config before replaying the manifest route', async () => {
    const harness = makeFakePage();
    const authenticateBrowser = vi.fn().mockResolvedValue(undefined);
    const config = {
      targetUrl: 'https://preview.example.test/root',
      autoCapture: { networkErrorMinStatus: 500 },
      browser: { headless: true },
      models: { planner: 'anthropic/claude-sonnet-4-6' },
    } as DramaturgeConfig;

    const result = await confirmManifest(
      makeManifest({
        origin: {
          runStartedAt: '2026-05-20T18:00:00.000Z',
          targetUrl: 'https://example.com/app',
          route: '/checkout',
          authProfile: 'customer',
        },
      }),
      createLiveReplayAdapter({
        authenticateBrowser,
        config,
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
        profile: 'admin',
      })
    );

    expect(result.verdict).toBe('fixed');
    expect(authenticateBrowser).toHaveBeenCalledWith(expect.anything(), config, 'admin');
    expect(harness.calls.goto).toEqual(['https://preview.example.test/checkout']);
  });

  it('falls back to the manifest auth profile when no profile override is provided', async () => {
    const harness = makeFakePage();
    const authenticateBrowser = vi.fn().mockResolvedValue(undefined);
    const config = {
      targetUrl: 'https://preview.example.test/root',
      autoCapture: { networkErrorMinStatus: 500 },
      browser: { headless: true },
      models: { planner: 'anthropic/claude-sonnet-4-6' },
    } as DramaturgeConfig;

    await confirmManifest(
      makeManifest({
        origin: {
          runStartedAt: '2026-05-20T18:00:00.000Z',
          targetUrl: 'https://example.com/app',
          route: '/checkout',
          authProfile: 'customer',
        },
      }),
      createLiveReplayAdapter({
        authenticateBrowser,
        config,
        createBrowserAgent: () => makeFakeBrowserAgent(harness),
      })
    );

    expect(authenticateBrowser).toHaveBeenCalledWith(expect.anything(), config, 'customer');
  });
});
