export interface AssertionInferenceInput {
  title: string;
  expected: string;
  actual: string;
}

export interface InferredAssertion {
  code: string;
  reason: string;
}

function normalizedText(input: AssertionInferenceInput): string {
  return `${input.title} ${input.expected} ${input.actual}`.toLowerCase();
}

export function inferAssertions(
  input: AssertionInferenceInput
): InferredAssertion[] {
  const text = normalizedText(input);
  const assertions: InferredAssertion[] = [];

  if (/\b(dialog|modal)\b/.test(text) && /\b(open|opens|visible|appears)\b/.test(text)) {
    assertions.push({
      code: 'await expect(page.getByRole("dialog")).toBeVisible();',
      reason: "Expected behavior mentions a dialog or modal becoming visible.",
    });
  }

  if (
    /\b(alert|toast|success message|error message|feedback|banner)\b/.test(text) &&
    /\b(appears|visible|confirms|feedback)\b/.test(text)
  ) {
    assertions.push({
      code: 'await expect(page.getByRole("alert")).toBeVisible();',
      reason: "Expected behavior mentions user-facing alert or toast feedback.",
    });
  }

  return assertions;
}
