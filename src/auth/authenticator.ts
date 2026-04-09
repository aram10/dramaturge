// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import type { DramaturgeConfig } from '../config.js';
import { adaptStagehand } from '../browser/page-interface.js';
import { authenticateNone } from './none.js';
import { authenticateStoredState } from './stored-state.js';
import { authenticateForm } from './form.js';
import { authenticateOAuthRedirect } from './oauth-redirect.js';
import { authenticateInteractive } from './interactive.js';

export async function authenticate(stagehand: Stagehand, config: DramaturgeConfig): Promise<void> {
  const { auth, targetUrl } = config;
  const browser = adaptStagehand(stagehand);

  switch (auth.type) {
    case 'none':
      return authenticateNone(browser, targetUrl);

    case 'stored-state':
      return authenticateStoredState(browser, targetUrl, auth.stateFile, auth.successIndicator);

    case 'form':
      return authenticateForm(
        browser,
        targetUrl,
        auth.loginUrl,
        auth.fields,
        auth.submit,
        auth.successIndicator
      );

    case 'oauth-redirect':
      return authenticateOAuthRedirect(
        browser,
        targetUrl,
        auth.loginUrl,
        auth.steps,
        auth.successIndicator
      );

    case 'interactive':
      return authenticateInteractive(
        browser,
        targetUrl,
        auth.loginUrl,
        auth.successIndicator,
        auth.stateFile,
        auth.manualTimeoutSeconds * 1000
      );
  }
}
