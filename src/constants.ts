import { randomUUID } from "node:crypto";

/** Generate a short 8-character UUID prefix for human-readable IDs. */
export function shortId(): string {
  return randomUUID().slice(0, 8);
}

/** Max characters for error grouping keys (console messages, network errors). */
export const TRUNCATE_GROUP_KEY = 200;

/** Max characters for evidence summary fields. */
export const TRUNCATE_SUMMARY = 120;

/** Max characters for finding title fields. */
export const TRUNCATE_TITLE = 80;

/** Max characters for Mermaid diagram node labels. */
export const TRUNCATE_MERMAID_LABEL = 60;

/** Max retry attempts before marking a frontier task unreachable. */
export const MAX_NAV_RETRIES = 2;

/** Priority decay factor applied when requeuing a failed/blocked frontier item. */
export const REQUEUE_PRIORITY_DECAY = 0.8;

/** Delay (ms) after a non-URL navigation action to let the page settle. */
export const NAV_SETTLE_DELAY_MS = 500;

/** Zero-padding width for finding IDs (e.g., "BUG-001"). */
export const FINDING_ID_PAD = 3;
