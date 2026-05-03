// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, vi } from 'vitest';
import type { DramaturgeConfig } from '../config.js';
import { attachSafetyRequestGuard, createSafetyGuardForConfig } from './safety.js';

function makeConfig(
  overrides: Partial<DramaturgeConfig['policy']['safety']> = {}
): DramaturgeConfig {
  return {
    policy: {
      expectedResponses: [],
      ignoredConsolePatterns: [],
      safety: {
        enabled: true,
        allowedUrlPatterns: [],
        blockedUrlPatterns: [],
        destructiveActionKeywords: ['delete'],
        maxAuditEntries: 500,
        ...overrides,
      },
    },
  } as DramaturgeConfig;
}

describe('createSafetyGuardForConfig', () => {
  it('creates a default guard that blocks destructive requests', () => {
    const guard = createSafetyGuardForConfig(makeConfig());

    expect(guard).toBeDefined();
    expect(guard?.checkRequest('DELETE', 'https://example.com/api/users/1')).not.toBeNull();
    expect(guard?.checkRequest('GET', 'https://example.com/api/users/1')).toBeNull();
  });

  it('returns undefined when safety policy is disabled', () => {
    expect(createSafetyGuardForConfig(makeConfig({ enabled: false }))).toBeUndefined();
  });

  it('honors configured URL allow and block patterns', () => {
    const guard = createSafetyGuardForConfig(
      makeConfig({
        allowedUrlPatterns: ['https://example.com/app/**'],
        blockedUrlPatterns: ['/app/admin/**'],
      })
    );

    expect(guard?.checkUrl('https://example.com/app/dashboard')).toBeNull();
    expect(guard?.checkUrl('https://example.com/app/admin/users')).not.toBeNull();
    expect(guard?.checkUrl('https://example.com/marketing')).not.toBeNull();
  });

  it('uses mission destructive-action opt-in when policy does not override request blocking', () => {
    const guard = createSafetyGuardForConfig(makeConfig(), {
      appDescription: 'Test app',
      destructiveActionsAllowed: true,
    });

    expect(guard?.checkRequest('DELETE', 'https://example.com/api/users/1')).toBeNull();
  });
});

describe('attachSafetyRequestGuard', () => {
  it('aborts blocked destructive requests and continues allowed requests', async () => {
    const guard = createSafetyGuardForConfig(makeConfig());
    routeCalls.abort.mockClear();
    routeCalls.continue.mockClear();
    let handler: ((route: RouteHarness) => Promise<void>) | undefined;
    const page = {
      route: vi.fn((_pattern: string, next: (route: RouteHarness) => Promise<void>) => {
        handler = next;
        return Promise.resolve();
      }),
    };

    await attachSafetyRequestGuard(page, guard);

    expect(page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    await handler?.(makeRoute('DELETE'));
    await handler?.(makeRoute('GET'));

    expect(routeCalls.abort).toHaveBeenCalledTimes(1);
    expect(routeCalls.continue).toHaveBeenCalledTimes(1);
  });

  it('aborts blocked navigation requests before they leave the page', async () => {
    const guard = createSafetyGuardForConfig(
      makeConfig({
        blockedUrlPatterns: ['/admin/**'],
      })
    );
    routeCalls.abort.mockClear();
    routeCalls.continue.mockClear();
    let handler: ((route: RouteHarness) => Promise<void>) | undefined;
    const page = {
      route: vi.fn((_pattern: string, next: (route: RouteHarness) => Promise<void>) => {
        handler = next;
        return Promise.resolve();
      }),
    };

    await attachSafetyRequestGuard(page, guard);
    await handler?.(
      makeRoute('GET', {
        url: 'https://example.com/admin/users',
        isNavigationRequest: true,
        resourceType: 'document',
      })
    );
    await handler?.(
      makeRoute('GET', {
        url: 'https://example.com/app/dashboard',
        isNavigationRequest: true,
        resourceType: 'document',
      })
    );

    expect(routeCalls.abort).toHaveBeenCalledTimes(1);
    expect(routeCalls.continue).toHaveBeenCalledTimes(1);
  });
});

interface RouteHarness {
  request: () => {
    method: () => string;
    url: () => string;
    isNavigationRequest?: () => boolean;
    resourceType?: () => string;
  };
  abort: (errorCode?: string) => Promise<unknown>;
  continue: () => Promise<unknown>;
}

const routeCalls = {
  abort: vi.fn(() => Promise.resolve()),
  continue: vi.fn(() => Promise.resolve()),
};

function makeRoute(
  method: string,
  options: { url?: string; isNavigationRequest?: boolean; resourceType?: string } = {}
): RouteHarness {
  return {
    request: () => ({
      method: () => method,
      url: () => options.url ?? 'https://example.com/api/users/1',
      isNavigationRequest: () => options.isNavigationRequest ?? false,
      resourceType: () => options.resourceType ?? 'xhr',
    }),
    abort: routeCalls.abort,
    continue: routeCalls.continue,
  };
}
