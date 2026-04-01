import type { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Evidence, CoverageEvent, FollowupRequest, DiscoveredEdge } from "../types.js";
import { shortId } from "../constants.js";
import type { CoverageTracker } from "../coverage/tracker.js";
import type { StagnationTracker } from "./stagnation.js";
import type { ActionRecorder } from "./action-recorder.js";
import type { Observation } from "../judge/types.js";

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
  verdict: z
    .object({
      hypothesis: z.string(),
      observation: z.string(),
      evidenceChain: z.array(z.string()).default([]),
      alternativesConsidered: z.array(z.string()).default([]),
      suggestedVerification: z.array(z.string()).default([]),
    })
    .optional(),
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
  type: z.enum(["navigation", "form", "crud", "api", "adversarial"]),
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
  observations: Observation[],
  screenshots: Map<string, Buffer>,
  evidence: Evidence[],
  coverageTracker: CoverageTracker,
  page: StagehandPage,
  screenshotDir: string,
  areaName: string,
  followupRequests: FollowupRequest[] = [],
  discoveredEdges: DiscoveredEdge[] = [],
  screenshotsEnabled = true,
  stagnationTracker?: StagnationTracker,
  findingContext?: {
    stateId?: string;
    objective?: string;
  },
  actionRecorder?: ActionRecorder
) {
  mkdirSync(screenshotDir, { recursive: true });
  const breadcrumbs: string[] = [];

  const rememberBreadcrumb = (value: string) => {
    breadcrumbs.push(value);
    if (breadcrumbs.length > 8) {
      breadcrumbs.shift();
    }
  };

  return {
    log_finding: {
      description:
        "Report a bug, UX concern, accessibility, performance, or visual issue. Attach evidence IDs from take_screenshot calls.",
      inputSchema: LogFindingSchema,
      execute: async (input: z.infer<typeof LogFindingSchema>) => {
        const evidenceIds = input.evidenceIds ?? [];
        const observationId = `obs-${shortId()}`;
        observations.push({
          id: observationId,
          ...input,
          evidenceIds,
          route: page.url(),
          objective: findingContext?.objective ?? "Investigate the current page",
          breadcrumbs: actionRecorder?.getRecentSummaries() ?? [...breadcrumbs],
          actionIds: actionRecorder?.getRecentActionIds() ?? [],
          verdictHint: input.verdict,
        });
        // Cross-link evidence to this finding
        if (evidenceIds.length > 0) {
          for (const eid of evidenceIds) {
            const ev = evidence.find((e) => e.id === eid);
            if (ev) {
              ev.relatedFindingIds.push(observationId);
            }
          }
        }
        stagnationTracker?.recordStep({ findings: 1, newControls: 0, edges: 0 });
        return {
          logged: true,
          observationId,
          observationIndex: observations.length - 1,
          message: `Observation logged: ${input.title}`,
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
        let buffer: Buffer;
        try {
          buffer = await page.screenshot({
            fullPage: false,
            type: "png",
          });
        } catch (screenshotError) {
          const msg = screenshotError instanceof Error ? screenshotError.message : String(screenshotError);
          return { captured: false, ref: input.ref, message: `Screenshot failed: ${msg}` };
        }
        const screenshotId = `ss-${shortId()}`;
        screenshots.set(screenshotId, buffer);
        const filename = `${screenshotId}.png`;
        try {
          writeFileSync(join(screenshotDir, filename), buffer);
        } catch (writeError) {
          const msg = writeError instanceof Error ? writeError.message : String(writeError);
          console.warn(`Failed to write screenshot file ${filename}: ${msg}`);
        }

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
        rememberBreadcrumb(`capture screenshot ${input.ref}`);
        actionRecorder?.recordToolAction({
          kind: "screenshot",
          summary: `capture screenshot ${input.ref}`,
          source: "worker-tool",
          status: "recorded",
        });

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
        rememberBreadcrumb(`${input.action} ${input.controlId} -> ${input.outcome}`);
        actionRecorder?.recordControlAction(
          input.controlId,
          input.action,
          input.outcome
        );
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
        rememberBreadcrumb(`discover edge ${input.actionLabel}`);
        actionRecorder?.recordToolAction({
          kind: "discover-edge",
          selector: input.selector,
          url: input.url,
          summary: `discover edge ${input.actionLabel}`,
          source: "worker-tool",
          status: "recorded",
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
