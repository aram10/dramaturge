import { describe, expect, it } from "vitest";
import { inferAssertions } from "./assertion-inference.js";

describe("inferAssertions", () => {
  it("infers an alert assertion from success-message expectations", () => {
    const assertions = inferAssertions({
      title: "Save feedback is unclear",
      expected: "A success message confirms the save",
      actual: "The page changes without feedback",
    });

    expect(assertions.map((assertion) => assertion.code)).toContain(
      'await expect(page.getByRole("alert")).toBeVisible();'
    );
  });

  it("infers a dialog assertion when the expected behavior mentions a modal opening", () => {
    const assertions = inferAssertions({
      title: "Create dialog never opens",
      expected: "The create dialog opens",
      actual: "Nothing happens",
    });

    expect(assertions.map((assertion) => assertion.code)).toContain(
      'await expect(page.getByRole("dialog")).toBeVisible();'
    );
  });
});
