import type { Stagehand } from '@browserbasehq/stagehand';
import type { DramaturgeConfig } from '../config.js';
import { authenticateNone } from './none.js';
import { authenticateStoredState } from './stored-state.js';
import { authenticateForm } from './form.js';
import { authenticateOAuthRedirect } from './oauth-redirect.js';
import { authenticateInteractive } from './interactive.js';

export async function authenticate(stagehand: Stagehand, config: DramaturgeConfig): Promise<void> {
  const { auth, targetUrl, models } = config;

  switch (auth.type) {
    case 'none':
      return authenticateNone(stagehand, targetUrl);

    case 'stored-state':
      return authenticateStoredState(stagehand, targetUrl, auth.stateFile, auth.successIndicator);

    case 'form':
      return authenticateForm(
        stagehand,
        targetUrl,
        auth.loginUrl,
        auth.fields,
        auth.submit,
        auth.successIndicator
      );

    case 'oauth-redirect':
      return authenticateOAuthRedirect(
        stagehand,
        targetUrl,
        auth.loginUrl,
        auth.steps,
        auth.successIndicator
      );

    case 'interactive':
      return authenticateInteractive(
        stagehand,
        targetUrl,
        auth.loginUrl,
        auth.successIndicator,
        auth.stateFile,
        auth.manualTimeoutSeconds * 1000
      );
  }
}
