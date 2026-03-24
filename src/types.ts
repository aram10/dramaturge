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

export interface RawFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  screenshotRef?: string;
}

export interface Finding extends RawFinding {
  id: string;
  area: string;
  screenshot?: string;
}

export interface AreaResult {
  name: string;
  url?: string;
  steps: number;
  findings: RawFinding[];
  screenshots: Map<string, Buffer>;
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
