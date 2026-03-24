import type { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RawFinding } from "../types.js";

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

export function createWorkerTools(
  findings: RawFinding[],
  screenshots: Map<string, Buffer>,
  page: StagehandPage,
  screenshotDir: string
) {
  mkdirSync(screenshotDir, { recursive: true });

  return {
    log_finding: {
      description:
        "Report a bug, UX concern, accessibility issue, performance issue, or visual glitch found during exploration. Call this whenever you observe something that seems wrong, broken, or could be improved.",
      inputSchema: LogFindingSchema,
      execute: async (input: z.infer<typeof LogFindingSchema>) => {
        findings.push(input);
        return {
          logged: true,
          findingIndex: findings.length - 1,
          message: `Finding logged: ${input.title}`,
        };
      },
    },

    take_screenshot: {
      description:
        "Capture a screenshot of the current page state. Use this to document visual issues, unexpected states, or as evidence for a finding. Set ref to match a finding you are about to log or have just logged.",
      inputSchema: TakeScreenshotSchema,
      execute: async (input: z.infer<typeof TakeScreenshotSchema>) => {
        const buffer = await page.screenshot({
          fullPage: false,
          type: "png",
        });
        screenshots.set(input.ref, buffer);
        const filename = `${input.ref}.png`;
        writeFileSync(join(screenshotDir, filename), buffer);
        return { captured: true, ref: input.ref, filename };
      },
    },
  };
}
