import { describe, expect, it } from "vitest";
import { classifyPage } from "./page-classifier.js";

function createMockPage(input: {
  url: string;
  title?: string;
  formCount?: number;
  tableCount?: number;
  hasModal?: boolean;
  buttonLabels?: string[];
  headingText?: string;
  inputCount?: number;
}) {
  return {
    url: () => input.url,
    evaluate: async () => ({
      pathname: new URL(input.url).pathname.toLowerCase(),
      title: (input.title ?? "").toLowerCase(),
      formCount: input.formCount ?? 0,
      tableCount: input.tableCount ?? 0,
      hasModal: input.hasModal ?? false,
      buttonLabels: (input.buttonLabels ?? []).map((label) => label.toLowerCase()),
      headingText: (input.headingText ?? "").toLowerCase(),
      inputCount: input.inputCount ?? 0,
    }),
  };
}

describe("classifyPage", () => {
  it("classifies a minimal root page as landing instead of dashboard", async () => {
    const page = createMockPage({
      url: "https://example.com/",
      title: "Welcome",
      headingText: "Welcome",
    });

    await expect(classifyPage(page as any)).resolves.toBe("landing");
  });

  it("classifies dashboard pages when dashboard signals are present", async () => {
    const page = createMockPage({
      url: "https://example.com/dashboard",
      title: "Overview",
      headingText: "Overview",
      buttonLabels: ["Refresh", "Export"],
    });

    await expect(classifyPage(page as any)).resolves.toBe("dashboard");
  });
});
