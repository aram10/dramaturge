// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import { resolveAuthProfile, type DramaturgeConfig } from '../config.js';
import { adaptStagehand } from '../browser/page-interface.js';
import { authenticateNone } from './none.js';
import { authenticateStoredState } from './stored-state.js';
import { authenticateForm } from './form.js';
import { authenticateOAuthRedirect } from './oauth-redirect.js';
import { authenticateInteractive } from './interactive.js';

/**
 * Authenticate using the provided Stagehand instance and config.
 * If a profileName is provided and the config uses auth profiles, it will authenticate
 * using that specific profile. Otherwise, it uses the default profile or the direct auth config.
 */
export async function authenticate(
  stagehand: Stagehand,
  config: DramaturgeConfig,
  profileName?: string
): Promise<void> {
  const { targetUrl } = config;
  const auth = resolveAuthProfile(config.auth, profileName);
  const browser = adaptStagehand(stagehand);

  switch (auth.type) {
    case 'none':
      return authenticateNone(browser, targetUrl);

    case 'stored-state':
      return authenticateStoredState(browser, targetUrl, auth.stateFile, auth.successIndicator);

    case 'form':
      return authenticateForm({
        browser,
        targetUrl,
        loginUrl: auth.loginUrl,
        fields: auth.fields,
        submit: auth.submit,
        successIndicator: auth.successIndicator,
      });

    case 'oauth-redirect':
      return authenticateOAuthRedirect(
        browser,
        targetUrl,
        auth.loginUrl,
        auth.steps,
        auth.successIndicator
      );

    case 'interactive':
      return authenticateInteractive({
        browser,
        targetUrl,
        loginUrl: auth.loginUrl,
        successIndicator: auth.successIndicator,
        stateFile: auth.stateFile,
        manualTimeoutMs: auth.manualTimeoutSeconds * 1000,
      });
  }
}
