export interface AssertionInferenceInput {
  title: string;
  expected: string;
  actual: string;
  /** Finding category for additional context. */
  category?: string;
  /** Evidence types linked to the finding (e.g. "console-error", "network-error"). */
  evidenceTypes?: string[];
}

export interface InferredAssertion {
  /** Setup code placed before actions (e.g. event listeners). */
  preamble?: string;
  code: string;
  reason: string;
}

function normalizedText(input: AssertionInferenceInput): string {
  return `${input.title} ${input.expected} ${input.actual}`.toLowerCase();
}

function hasEvidence(input: AssertionInferenceInput, type: string): boolean {
  return input.evidenceTypes?.includes(type) ?? false;
}

export function inferAssertions(
  input: AssertionInferenceInput
): InferredAssertion[] {
  const text = normalizedText(input);
  const assertions: InferredAssertion[] = [];

  // --- Dialog / Modal visibility ---
  if (/\b(dialog|modal)\b/.test(text) && /\b(open|opens|visible|appears)\b/.test(text)) {
    assertions.push({
      code: 'await expect(page.getByRole("dialog")).toBeVisible();',
      reason: "Expected behavior mentions a dialog or modal becoming visible.",
    });
  }

  // --- Alert / Toast feedback ---
  if (
    /\b(alert|toast|success message|error message|feedback|banner)\b/.test(text) &&
    /\b(appears|visible|confirms|feedback)\b/.test(text)
  ) {
    assertions.push({
      code: 'await expect(page.getByRole("alert")).toBeVisible();',
      reason: "Expected behavior mentions user-facing alert or toast feedback.",
    });
  }

  // --- HTTP response errors ---
  if (
    /\b(500|502|503|504|server error|internal server error|bad gateway|service unavailable)\b/.test(text) ||
    hasEvidence(input, "network-error")
  ) {
    assertions.push({
      preamble:
        "const serverErrors: string[] = [];\n" +
        '  page.on("response", (resp) => { if (resp.status() >= 500) serverErrors.push(`${resp.status()} ${resp.url()}`); });',
      code: 'expect(serverErrors, "No server errors expected").toHaveLength(0);',
      reason: "Finding indicates server-side HTTP errors; response listener verifies none occur.",
    });
  }

  // --- Form validation ---
  if (
    /\b(validation|validate|required field|invalid input|form error|constraint|must be filled|field is required)\b/.test(text) &&
    /\b(missing|absent|not shown|hidden|fails|broken|does not|doesn't)\b/.test(text)
  ) {
    assertions.push({
      code: `await expect(page.locator('[aria-invalid="true"], [role="alert"], .error-message, .field-error')).toBeVisible();`,
      reason: "Expected behavior involves form validation feedback being shown.",
    });
  }

  // --- CRUD / list changes ---
  if (
    /\b(list|table|row|rows|item|items|entry|entries|record|records)\b/.test(text) &&
    /\b(added|created|deleted|removed|updated|changed|empty|missing|count|appears|disappears)\b/.test(text)
  ) {
    assertions.push({
      code: `await expect(page.locator('table tbody tr, [role="row"], [role="listitem"]')).not.toHaveCount(0);`,
      reason: "Finding relates to CRUD or list content changes; asserts list is not empty.",
    });
  }

  // --- Visual diffs ---
  if (
    /\b(visual|layout|render|pixel|screenshot|misaligned|overlapping|clipped|truncated)\b/.test(text) ||
    hasEvidence(input, "visual-diff")
  ) {
    assertions.push({
      code: "await expect(page).toHaveScreenshot();",
      reason: "Finding involves visual presentation; screenshot comparison catches regressions.",
    });
  }

  // --- API contract deviations ---
  if (
    (/\b(api|endpoint|contract|schema|payload|response body|rest api)\b/.test(text) &&
      /\b(mismatch|violation|invalid|unexpected|deviat|broke|fail|error)\b/.test(text)) ||
    hasEvidence(input, "api-contract")
  ) {
    assertions.push({
      preamble:
        "const apiErrors: string[] = [];\n" +
        '  page.on("response", (resp) => { if (/\\/api\\//.test(resp.url()) && resp.status() >= 400) apiErrors.push(`${resp.status()} ${resp.url()}`); });',
      code: 'expect(apiErrors, "No API errors expected").toHaveLength(0);',
      reason: "Finding describes an API contract deviation; response listener validates API calls succeed.",
    });
  }

  // --- Console errors ---
  if (
    /\b(console error|console\.error|uncaught|runtime error|javascript error|js error|unhandled exception|thrown|stack trace)\b/.test(text) ||
    hasEvidence(input, "console-error")
  ) {
    assertions.push({
      preamble:
        "const consoleErrors: string[] = [];\n" +
        '  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });',
      code: 'expect(consoleErrors, "No console errors expected").toHaveLength(0);',
      reason: "Finding mentions console or runtime errors; listener captures errors during test execution.",
    });
  }

  return assertions;
}
