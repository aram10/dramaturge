import type { Stagehand } from "@browserbasehq/stagehand";
import { parseIndicator, waitForSuccess } from "./success-indicator.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export async function authenticateOAuthRedirect(
  stagehand: Stagehand,
  targetUrl: string,
  loginUrl: string,
  credentials: Record<string, string>,
  successIndicator: string,
  model: string
): Promise<void> {
  const page: StagehandPage = stagehand.context.pages()[0];
  const fullLoginUrl = new URL(loginUrl, targetUrl).href;

  await page.goto(fullLoginUrl);

  // Build credential instructions for the agent
  const credentialLines = Object.entries(credentials)
    .map(([field, value]) => `- ${field}: ${value}`)
    .join("\n");

  const agent = stagehand.agent({
    mode: "dom",
    model,
    systemPrompt: `You are logging into a web application via an OAuth/SSO provider.
Your job is to complete the login flow from start to finish.

You will encounter a login page that redirects to an identity provider (e.g., Microsoft, Google, Okta).
Fill in the credentials when prompted, handle any intermediate screens (like "Stay signed in?" prompts,
consent screens, or "Use this account?" prompts), and follow all redirects until you land back on the application.

Credentials to use:
${credentialLines}

Important:
- If you see a "Stay signed in?" prompt, click "Yes"
- If you see an account picker, select the account matching the email
- If you see a consent/permissions screen, click "Accept" or "Yes"
- Do NOT attempt to handle MFA/2FA prompts — if one appears, stop and report failure
- After clicking "Sign in" or "Submit", wait for the redirect to complete`,
  });

  await agent.execute({
    instruction:
      "Complete the login flow. Click the sign-in button on the app's login page, then fill in credentials on the identity provider's page, and follow all redirects back to the app.",
    maxSteps: 15,
  });

  // Verify login succeeded
  const indicator = parseIndicator(successIndicator);
  await waitForSuccess(page, indicator);
}
