import type { Stagehand } from "@browserbasehq/stagehand";
import type { PageType } from "../types.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

// Keyword lists for deterministic page classification
const AUTH_PATH_KEYWORDS = ["login", "signin", "auth"];
const AUTH_TITLE_KEYWORDS = ["sign in", "log in"];
const WIZARD_BUTTON_LABELS = ["next", "previous", "back", "step"];
const WIZARD_PATH_KEYWORDS = ["wizard", "step"];
const SETTINGS_PATH_KEYWORDS = ["settings", "preferences", "config"];
const SETTINGS_HEADING_KEYWORDS = ["settings", "preferences"];
const LIST_BUTTON_LABELS = ["filter", "search", "sort", "delete", "edit", "create", "add", "new"];
const DASHBOARD_PATH_KEYWORDS = ["dashboard", "home"];
const DASHBOARD_HEADING_KEYWORDS = ["dashboard", "overview"];

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
    AUTH_PATH_KEYWORDS.some((k) => s.pathname.includes(k)) ||
    AUTH_TITLE_KEYWORDS.some((k) => s.title.includes(k))
  ) {
    return "auth";
  }

  // Modal overlay
  if (s.hasModal) {
    return "modal";
  }

  // Wizard / multi-step
  if (
    WIZARD_PATH_KEYWORDS.some((k) => s.pathname.includes(k)) ||
    WIZARD_BUTTON_LABELS.some((w) => s.buttonLabels.some((b) => b.includes(w)))
  ) {
    if (s.inputCount > 0) {
      return "wizard";
    }
  }

  // Settings pages
  if (
    SETTINGS_PATH_KEYWORDS.some((k) => s.pathname.includes(k)) ||
    SETTINGS_HEADING_KEYWORDS.some((k) => s.headingText.includes(k))
  ) {
    return "settings";
  }

  // Form pages (many inputs, few or no tables)
  if (s.formCount > 0 && s.inputCount >= 3 && s.tableCount === 0) {
    return "form";
  }

  // List pages (tables or grids with action buttons)
  if (
    s.tableCount > 0 ||
    (s.pathname.includes("list") && LIST_BUTTON_LABELS.some((l) => s.buttonLabels.some((b) => b.includes(l))))
  ) {
    return "list";
  }

  // Detail pages (specific ID-like patterns in path)
  if (/\/[a-f0-9-]{8,}|\/\d+$/.test(s.pathname)) {
    return "detail";
  }

  // Landing page (root with minimal interactive elements)
  if (
    s.pathname === "/" &&
    s.formCount === 0 &&
    s.tableCount === 0 &&
    !DASHBOARD_HEADING_KEYWORDS.some((k) => s.headingText.includes(k))
  ) {
    return "landing";
  }

  // Dashboard pages
  if (
    DASHBOARD_PATH_KEYWORDS.some((k) => s.pathname.includes(k)) ||
    DASHBOARD_HEADING_KEYWORDS.some((k) => s.headingText.includes(k))
  ) {
    return "dashboard";
  }

  return "unknown";
}
