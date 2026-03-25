import type { Stagehand } from "@browserbasehq/stagehand";
import type { PageType } from "../types.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

interface ClassificationSignals {
  pathname: string;
  title: string;
  formCount: number;
  tableCount: number;
  hasModal: boolean;
  buttonLabels: string[];
  headingText: string;
  inputCount: number;
}

/**
 * Classify the current page using deterministic heuristics.
 * No LLM call — uses DOM signals only.
 */
export async function classifyPage(
  page: StagehandPage
): Promise<PageType> {
  const url = page.url();
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url;
  }

  const signals: ClassificationSignals = await page.evaluate(() => {
    const forms = document.querySelectorAll("form");
    const tables = document.querySelectorAll("table, [role='grid'], [role='table']");
    const modals = document.querySelectorAll(
      'dialog[open], [role="dialog"], [role="alertdialog"]'
    );
    const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit']"));
    const buttonLabels = buttons
      .map((b) => (b.textContent ?? "").trim().toLowerCase())
      .filter(Boolean);
    const h1 = document.querySelector("h1, h2");
    const headingText = (h1?.textContent ?? "").trim().toLowerCase();
    const inputs = document.querySelectorAll(
      "input:not([type='hidden']):not([type='submit']), textarea, select"
    );

    return {
      pathname: window.location.pathname.toLowerCase(),
      title: document.title.toLowerCase(),
      formCount: forms.length,
      tableCount: tables.length,
      hasModal: modals.length > 0,
      buttonLabels,
      headingText,
      inputCount: inputs.length,
    };
  });

  // Override with pathname in case evaluate pathname differs from outer
  signals.pathname = pathname;

  return classifyFromSignals(signals);
}

function classifyFromSignals(s: ClassificationSignals): PageType {
  // Auth pages
  if (
    s.pathname.includes("login") ||
    s.pathname.includes("signin") ||
    s.pathname.includes("auth") ||
    s.title.includes("sign in") ||
    s.title.includes("log in")
  ) {
    return "auth";
  }

  // Modal overlay
  if (s.hasModal) {
    return "modal";
  }

  // Wizard / multi-step
  const wizardLabels = ["next", "previous", "back", "step"];
  if (
    s.pathname.includes("wizard") ||
    s.pathname.includes("step") ||
    wizardLabels.some((w) => s.buttonLabels.some((b) => b.includes(w)))
  ) {
    // Only classify as wizard if there are also form inputs
    if (s.inputCount > 0) {
      return "wizard";
    }
  }

  // Settings pages
  if (
    s.pathname.includes("settings") ||
    s.pathname.includes("preferences") ||
    s.pathname.includes("config") ||
    s.headingText.includes("settings") ||
    s.headingText.includes("preferences")
  ) {
    return "settings";
  }

  // Form pages (many inputs, few or no tables)
  if (s.formCount > 0 && s.inputCount >= 3 && s.tableCount === 0) {
    return "form";
  }

  // List pages (tables or grids with action buttons)
  const listLabels = ["filter", "search", "sort", "delete", "edit", "create", "add", "new"];
  if (
    s.tableCount > 0 ||
    (s.pathname.includes("list") && listLabels.some((l) => s.buttonLabels.some((b) => b.includes(l))))
  ) {
    return "list";
  }

  // Detail pages (specific ID-like patterns in path)
  if (/\/[a-f0-9-]{8,}|\/\d+$/.test(s.pathname)) {
    return "detail";
  }

  // Dashboard pages
  if (
    s.pathname === "/" ||
    s.pathname.includes("dashboard") ||
    s.pathname.includes("home") ||
    s.headingText.includes("dashboard") ||
    s.headingText.includes("overview")
  ) {
    return "dashboard";
  }

  // Landing page (root with minimal interactive elements)
  if (s.pathname === "/" && s.formCount === 0 && s.tableCount === 0) {
    return "landing";
  }

  return "unknown";
}
