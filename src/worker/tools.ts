import type { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RawFinding, Evidence, CoverageEvent, FollowupRequest, DiscoveredEdge } from "../types.js";
import { shortId } from "../constants.js";
import type { CoverageTracker } from "../coverage/tracker.js";
import type { StagnationTracker } from "./stagnation.js";

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
  category: FindingCategorySchema,
  severity: FindingSeveritySchema.describe(
    "Critical = crash/data loss, Major = broken feature, Minor = cosmetic/inconvenience, Trivial = nitpick"
  ),
  title: z.string().describe("One-line summary of the issue"),
  stepsToReproduce: z.array(z.string()).describe("Ordered actions to encounter this issue"),
  expected: z.string(),
  actual: z.string(),
  evidenceIds: z.array(z.string()).optional().describe("Evidence IDs from take_screenshot"),
});

const TakeScreenshotSchema = z.object({
  annotation: z.string().optional().describe("What the screenshot shows"),
  ref: z.string().describe("Reference ID to correlate with a finding (e.g., 'bug-empty-form')"),
});

const MarkControlExercisedSchema = z.object({
  controlId: z.string().describe("Control identifier (e.g., 'save-button', 'name-input')"),
  action: z.enum(["click", "input", "submit", "toggle", "open", "close"]),
  outcome: z.enum(["worked", "blocked", "error", "unclear"]),
});

const RequestFollowupSchema = z.object({
  type: z.enum(["navigation", "form", "crud"]),
  reason: z.string(),
  relatedFindingId: z.string().optional(),
});

const ReportDiscoveredEdgeSchema = z.object({
  actionLabel: z.string().describe("Action leading to new state (e.g., 'Click Create User button')"),
  url: z.string().optional().describe("Direct URL of the discovered page, if known"),
  selector: z.string().optional(),
  actionDescription: z.string().optional().describe("Natural language action description"),
});

export function createWorkerTools(
  findings: RawFinding[],
  screenshots: Map<string, Buffer>,
  evidence: Evidence[],
  coverageTracker: CoverageTracker,
  page: StagehandPage,
  screenshotDir: string,
  areaName: string,
  followupRequests: FollowupRequest[] = [],
  discoveredEdges: DiscoveredEdge[] = [],
  screenshotsEnabled = true,
  stagnationTracker?: StagnationTracker
) {
  mkdirSync(screenshotDir, { recursive: true });

  return {
    log_finding: {
      description:
        "Report a bug, UX concern, accessibility, performance, or visual issue. Attach evidence IDs from take_screenshot calls.",
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
        stagnationTracker?.recordStep({ findings: 1, newControls: 0, edges: 0 });
        return {
          logged: true,
          findingIndex: findings.length - 1,
          message: `Finding logged: ${input.title}`,
        };
      },
    },

    take_screenshot: {
      description:
        "Capture a screenshot. Returns an evidenceId to pass to log_finding.",
      inputSchema: TakeScreenshotSchema,
      execute: async (input: z.infer<typeof TakeScreenshotSchema>) => {
        if (!screenshotsEnabled) {
          return { captured: false, ref: input.ref, message: "Screenshots disabled in config" };
        }
        const buffer = await page.screenshot({
          fullPage: false,
          type: "png",
        });
        screenshots.set(input.ref, buffer);
        const filename = `${input.ref}.png`;
        writeFileSync(join(screenshotDir, filename), buffer);

        const evidenceId = `ev-${shortId()}`;
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
        "Report interaction with a UI control for coverage tracking.",
      inputSchema: MarkControlExercisedSchema,
      execute: async (input: z.infer<typeof MarkControlExercisedSchema>) => {
        const event: CoverageEvent = {
          controlId: input.controlId,
          action: input.action,
          outcome: input.outcome,
          timestamp: new Date().toISOString(),
        };
        coverageTracker.recordEvent(event);
        stagnationTracker?.recordStep({ findings: 0, newControls: 1, edges: 0 });
        return {
          recorded: true,
          controlId: input.controlId,
          message: `Coverage recorded: ${input.action} on ${input.controlId} → ${input.outcome}`,
        };
      },
    },

    request_followup: {
      description:
        "Request additional investigation on the current page or a related area.",
      inputSchema: RequestFollowupSchema,
      execute: async (input: z.infer<typeof RequestFollowupSchema>) => {
        followupRequests.push({
          type: input.type,
          reason: input.reason,
          relatedFindingId: input.relatedFindingId,
        });
        return {
          requested: true,
          message: `Follow-up requested: ${input.type} — ${input.reason}`,
        };
      },
    },

    report_discovered_edge: {
      description:
        "Report a navigation target (link, button, action) leading to a different page/state.",
      inputSchema: ReportDiscoveredEdgeSchema,
      execute: async (
        input: z.infer<typeof ReportDiscoveredEdgeSchema>
      ) => {
        discoveredEdges.push({
          actionLabel: input.actionLabel,
          navigationHint: {
            url: input.url,
            selector: input.selector,
            actionDescription: input.actionDescription,
          },
          // Placeholder — engine fills these when it actually navigates
          targetFingerprint: {
            normalizedPath: "",
            signature: {
              pathname: "",
              query: [],
              uiMarkers: [],
            },
            title: "",
            heading: "",
            dialogTitles: [],
            hash: "",
          },
          targetPageType: "unknown",
        });
        stagnationTracker?.recordStep({ findings: 0, newControls: 0, edges: 1 });
        return {
          reported: true,
          message: `Discovered edge: ${input.actionLabel}`,
        };
      },
    },
  };
}
