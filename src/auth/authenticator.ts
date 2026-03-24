import type { Stagehand } from "@browserbasehq/stagehand";
import type { WebProbeConfig } from "../config.js";
import { authenticateNone } from "./none.js";
import { authenticateStoredState } from "./stored-state.js";
import { authenticateForm } from "./form.js";
import { authenticateOAuthRedirect } from "./oauth-redirect.js";

export async function authenticate(
  stagehand: Stagehand,
  config: WebProbeConfig
): Promise<void> {
  const { auth, targetUrl, models } = config;

  switch (auth.type) {
    case "none":
      return authenticateNone(stagehand, targetUrl);

    case "stored-state":
      return authenticateStoredState(stagehand, targetUrl, auth.stateFile);

    case "form":
      return authenticateForm(
        stagehand,
        targetUrl,
        auth.loginUrl,
        auth.credentials,
        auth.successIndicator
      );

    case "oauth-redirect":
      return authenticateOAuthRedirect(
        stagehand,
        targetUrl,
        auth.loginUrl,
        auth.credentials,
        auth.successIndicator,
        models.orchestrator
      );
  }
}
