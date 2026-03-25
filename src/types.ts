export type FindingCategory =
  | "Bug"
  | "UX Concern"
  | "Accessibility Issue"
  | "Performance Issue"
  | "Visual Glitch";

export type FindingSeverity = "Critical" | "Major" | "Minor" | "Trivial";

export const CATEGORY_PREFIX: Record<FindingCategory, string> = {
  Bug: "BUG",
  "UX Concern": "UX",
  "Accessibility Issue": "A11Y",
  "Performance Issue": "PERF",
  "Visual Glitch": "VIS",
};

// --- Evidence model ---

export interface Evidence {
  id: string;
  type: "screenshot" | "console-error" | "network-error";
  summary: string;
  path?: string;
  timestamp: string;
  areaName?: string;
  relatedFindingIds: string[];
}

// --- Page classification ---

export type PageType =
  | "landing"
  | "dashboard"
  | "list"
  | "detail"
  | "form"
  | "wizard"
  | "settings"
  | "modal"
  | "auth"
  | "unknown";

// --- Coverage tracking ---

export type ControlAction =
  | "click"
  | "input"
  | "submit"
  | "toggle"
  | "open"
  | "close";

export type ControlOutcome = "worked" | "blocked" | "error" | "unclear";

export interface CoverageEvent {
  controlId: string;
  action: ControlAction;
  outcome: ControlOutcome;
  timestamp: string;
}

export interface CoverageSnapshot {
  controlsDiscovered: number;
  controlsExercised: number;
  events: CoverageEvent[];
}

// --- Findings ---

export interface RawFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  screenshotRef?: string;
  evidenceIds?: string[];
}

export interface Finding extends RawFinding {
  id: string;
  area: string;
  screenshot?: string;
}

// --- Page fingerprint ---

export interface PageFingerprint {
  normalizedPath: string;
  title: string;
  heading: string;
  dialogTitles: string[];
  hash: string;
}

// --- Area and results ---

export interface AreaResult {
  name: string;
  url?: string;
  steps: number;
  findings: RawFinding[];
  screenshots: Map<string, Buffer>;
  evidence: Evidence[];
  coverage: CoverageSnapshot;
  pageType: PageType;
  fingerprint?: PageFingerprint;
  status: "explored" | "failed" | "timeout" | "skipped";
  failureReason?: string;
}

export interface Area {
  name: string;
  url?: string;
  selector?: string;
  description?: string;
}

export interface RunResult {
  targetUrl: string;
  startTime: Date;
  endTime: Date;
  areaResults: AreaResult[];
  unexploredAreas: Array<{ name: string; reason: string }>;
  partial: boolean;
}
