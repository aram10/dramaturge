// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { DramaturgeConfig } from '../config.js';
import type { MissionConfig } from '../types.js';
import {
  SafetyGuard,
  createDefaultSafetyConfig,
  createSafetyConfigFromPolicy,
  type SafetyGuardPolicyOptions,
} from '../policy/safety-guard.js';
import type { EngineLogger } from './logger.js';

interface RequestLike {
  method: () => string;
  url: () => string;
  isNavigationRequest?: () => boolean;
  resourceType?: () => string;
}

interface RouteLike {
  request: () => RequestLike;
  abort: (errorCode?: string) => Promise<unknown>;
  continue: () => Promise<unknown>;
}

interface RoutablePage {
  route: (url: string, handler: (route: RouteLike) => Promise<void>) => Promise<unknown>;
  on?: (event: 'framenavigated', handler: () => void) => void;
  url?: () => string;
}

function isRoutablePage(page: unknown): page is RoutablePage {
  return typeof (page as { route?: unknown }).route === 'function';
}

export function createSafetyGuardForConfig(
  config: DramaturgeConfig,
  mission?: MissionConfig
): SafetyGuard | undefined {
  const destructiveActionsAllowed = mission?.destructiveActionsAllowed ?? false;
  const safetyPolicy = config.policy?.safety;

  if (safetyPolicy?.enabled === false) {
    return undefined;
  }

  const guardConfig = safetyPolicy
    ? createSafetyConfigFromPolicy(
        safetyPolicy as SafetyGuardPolicyOptions,
        destructiveActionsAllowed
      )
    : createDefaultSafetyConfig(destructiveActionsAllowed);
  const guard = new SafetyGuard(guardConfig);
  // Confine exploration to the target origin by default so the agent cannot wander
  // off-site (e.g. an adversarial worker following an external link).
  guard.allowOrigin(config.targetUrl);
  return guard;
}

function sanitizeUrl(raw: string): string {
  try {
    const { origin, pathname } = new URL(raw);
    return `${origin}${pathname}`;
  } catch {
    return raw;
  }
}

export async function attachSafetyRequestGuard(
  page: unknown,
  safetyGuard: SafetyGuard | undefined,
  logger?: EngineLogger
): Promise<void> {
  if (!safetyGuard || !isRoutablePage(page)) {
    return;
  }

  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    const safeUrl = sanitizeUrl(url);
    const urlBlocked = shouldCheckRequestUrl(request) ? safetyGuard.checkUrl(url) : null;
    if (urlBlocked) {
      logger?.warn('Blocked navigation by safety guard', {
        method,
        url: safeUrl,
        reason: urlBlocked,
      });
      await route.abort('blockedbyclient');
      return;
    }

    const blocked = safetyGuard.checkRequest(method, url);

    if (blocked) {
      logger?.warn('Blocked request by safety guard', { method, url: safeUrl, reason: blocked });
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  attachPageUrlGuard(page, safetyGuard, logger);
  checkCurrentPageUrl(page, safetyGuard, logger);
}

function shouldCheckRequestUrl(request: RequestLike): boolean {
  if (request.isNavigationRequest?.()) {
    return true;
  }

  // Gate document loads plus programmatic data requests (XHR/fetch) so a
  // cross-origin call cannot bypass origin scoping; static subresources
  // (scripts, styles, images, fonts) are allowed to load from any origin.
  const resourceType = request.resourceType?.();
  return resourceType === 'document' || resourceType === 'xhr' || resourceType === 'fetch';
}

function attachPageUrlGuard(
  page: RoutablePage,
  safetyGuard: SafetyGuard,
  logger?: EngineLogger
): void {
  if (typeof page.on !== 'function') {
    return;
  }

  page.on('framenavigated', () => {
    checkCurrentPageUrl(page, safetyGuard, logger);
  });
}

function checkCurrentPageUrl(
  page: RoutablePage,
  safetyGuard: SafetyGuard,
  logger?: EngineLogger
): void {
  if (typeof page.url !== 'function') {
    return;
  }

  const currentUrl = page.url();
  const blocked = safetyGuard.checkUrl(currentUrl);
  if (blocked) {
    logger?.warn('Blocked page URL by safety guard', {
      url: sanitizeUrl(currentUrl),
      reason: blocked,
    });
  }
}
