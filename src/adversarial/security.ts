import type { AdversarialScenario } from './stateful.js';

/**
 * OWASP-informed security adversarial scenarios.
 *
 * Inspired by ECC's security-review skill, these scenarios test for
 * common web security vulnerabilities that can be detected through
 * browser-level interaction without source code access.
 */

interface SecurityScenarioOptions {
  destructiveActionsAllowed: boolean;
}

const SECURITY_SCENARIOS: AdversarialScenario[] = [
  {
    id: 'csrf-token-absence',
    title: 'CSRF token absence on state-changing forms',
    description:
      'Find forms that perform state-changing operations (create, update, delete). ' +
      'Inspect the form for a hidden CSRF token field or verify that the submission includes ' +
      'a CSRF header (X-CSRF-Token, X-XSRF-TOKEN). Submit the form and check whether the ' +
      'request contains any anti-CSRF mechanism. Report if state-changing forms lack CSRF protection.',
    requiresMutation: true,
  },
  {
    id: 'xss-input-reflection',
    title: 'XSS input reflection',
    description:
      'Find text inputs, search fields, and URL parameters that display user content back on the page. ' +
      "Enter a benign marker string like '<b>test</b>' or '\"onmouseover=\"alert' and check whether " +
      'the value appears unescaped in the DOM. Look for inputs that are reflected in page headings, ' +
      'search result summaries, error messages, or URL-based content injection points.',
  },
  {
    id: 'missing-rate-limit',
    title: 'Missing rate limit on sensitive endpoints',
    description:
      'Find login forms, password reset forms, or API-calling search/filter controls. ' +
      'Submit the same request 5 times in rapid succession and observe whether any rate-limiting ' +
      'response occurs (HTTP 429, error message, CAPTCHA). Report if sensitive endpoints accept ' +
      'unlimited rapid requests without throttling.',
    requiresMutation: true,
  },
  {
    id: 'open-redirect',
    title: 'Open redirect via URL parameter',
    description:
      "Look for URL parameters that control navigation: 'redirect', 'next', 'return', 'callback', " +
      "'continue', or 'url' parameters in the current page's URL. If found, modify the parameter " +
      "to point to an external domain (e.g. 'https://example.com') and check if the application " +
      'redirects without validation. Report if the app follows arbitrary redirect targets.',
  },
];

export function listSecurityScenarios(options: SecurityScenarioOptions): AdversarialScenario[] {
  return SECURITY_SCENARIOS.filter(
    (scenario) => options.destructiveActionsAllowed || !scenario.requiresMutation
  );
}
