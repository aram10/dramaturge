import type { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RawFinding, Evidence, CoverageEvent } from "../types.js";
import type { CoverageTracker } from "../coverage/tracker.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

const FindingCategorySchema = z.enum([
  "Bug",
  "UX Concern",
  "Accessibility Issue",
  "Performance Issue",
  "Visual Glitch",
]);

const FindingSeveritySchema = z.enum([
  "Critical",
  "Major",
  "Minor",
  "Trivial",
]);

const LogFindingSchema = z.object({
  category: FindingCategorySchema.describe("The type of issue found"),
  severity: FindingSeveritySchema.describe(
    "Critical = crash/data loss, Major = broken feature, Minor = cosmetic/inconvenience, Trivial = nitpick"
  ),
  title: z.string().describe("One-line summary of the issue"),
  stepsToReproduce: z
    .array(z.string())
    .describe("Ordered list of actions taken to encounter this issue"),
  expected: z.string().describe("What should have happened"),
  actual: z.string().describe("What actually happened"),
  evidenceIds: z
    .array(z.string())
    .optional()
    .describe(
      "Evidence IDs from take_screenshot calls to link to this finding"
    ),
});

const TakeScreenshotSchema = z.object({
  annotation: z
    .string()
    .optional()
    .describe("Text description of what the screenshot shows"),
  ref: z
    .string()
    .describe(
      "Reference ID to correlate with a finding (e.g., 'bug-empty-form', 'ux-tooltip-overlap')"
    ),
});

const MarkControlExercisedSchema = z.object({
  controlId: z
    .string()
    .describe(
      "Identifier for the control (e.g., 'save-button', 'name-input', 'filter-dropdown')"
    ),
  action: z.enum(["click", "input", "submit", "toggle", "open", "close"]),
  outcome: z
    .enum(["worked", "blocked", "error", "unclear"])
    .describe("What happened when you interacted with the control"),
});

export function createWorkerTools(
  findings: RawFinding[],
  screenshots: Map<string, Buffer>,
  evidence: Evidence[],
  coverageTracker: CoverageTracker,
  page: StagehandPage,
  screenshotDir: string,
  areaName: string
) {
  mkdirSync(screenshotDir, { recursive: true });

  return {
    log_finding: {
      description:
        "Report a bug, UX concern, accessibility issue, performance issue, or visual glitch found during exploration. Call this whenever you observe something that seems wrong, broken, or could be improved. You can attach evidence IDs from previous take_screenshot calls.",
      inputSchema: LogFindingSchema,
      execute: async (input: z.infer<typeof LogFindingSchema>) => {
        findings.push(input);
        // Cross-link evidence to this finding
        if (input.evidenceIds) {
          const findingIndex = findings.length - 1;
          for (const eid of input.evidenceIds) {
            const ev = evidence.find((e) => e.id === eid);
            if (ev) {
              ev.relatedFindingIds.push(String(findingIndex));
            }
          }
        }
        return {
          logged: true,
          findingIndex: findings.length - 1,
          message: `Finding logged: ${input.title}`,
        };
      },
    },

    take_screenshot: {
      description:
        "Capture a screenshot of the current page state. Returns an evidenceId you can pass to log_finding to link them. Use this to document visual issues, unexpected states, or as evidence for a finding.",
      inputSchema: TakeScreenshotSchema,
      execute: async (input: z.infer<typeof TakeScreenshotSchema>) => {
        const buffer = await page.screenshot({
          fullPage: false,
          type: "png",
        });
        screenshots.set(input.ref, buffer);
        const filename = `${input.ref}.png`;
        writeFileSync(join(screenshotDir, filename), buffer);

        const evidenceId = `ev-${randomUUID().slice(0, 8)}`;
        const ev: Evidence = {
          id: evidenceId,
          type: "screenshot",
          summary: input.annotation ?? `Screenshot: ${input.ref}`,
          path: `screenshots/${filename}`,
          timestamp: new Date().toISOString(),
          areaName,
          relatedFindingIds: [],
        };
        evidence.push(ev);

        return { captured: true, ref: input.ref, filename, evidenceId };
      },
    },

    mark_control_exercised: {
      description:
        "Report that you interacted with a specific UI control. This tracks coverage — what controls were found and tested. Call this after clicking buttons, filling inputs, toggling switches, etc.",
      inputSchema: MarkControlExercisedSchema,
      execute: async (input: z.infer<typeof MarkControlExercisedSchema>) => {
        const event: CoverageEvent = {
          controlId: input.controlId,
          action: input.action,
          outcome: input.outcome,
          timestamp: new Date().toISOString(),
        };
        coverageTracker.recordEvent(event);
        return {
          recorded: true,
          controlId: input.controlId,
          message: `Coverage recorded: ${input.action} on ${input.controlId} → ${input.outcome}`,
        };
      },
    },
  };
}
