// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { randomUUID } from 'node:crypto';

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

/** Max routes to display in planner context summaries. */
export const MAX_ROUTES_IN_PLANNER = 3;

/** Max route families to display in planner context summaries. */
export const MAX_ROUTE_FAMILIES_IN_PLANNER = 3;

/** Max stable selectors to display in planner context summaries. */
export const MAX_STABLE_SELECTORS_IN_PLANNER = 3;

/** Max API endpoints to display in planner context summaries. */
export const MAX_API_ENDPOINTS_IN_PLANNER = 2;

/** Max login routes to display in planner context summaries. */
export const MAX_LOGIN_ROUTES_IN_PLANNER = 2;

/** Max routes to display in worker prompt context. */
export const MAX_ROUTES_IN_WORKER = 6;

/** Max route families to display in worker prompt context. */
export const MAX_ROUTE_FAMILIES_IN_WORKER = 6;

/** Max stable selectors to display in worker prompt context. */
export const MAX_STABLE_SELECTORS_IN_WORKER = 6;

/** Max API endpoints to display in worker prompt context. */
export const MAX_API_ENDPOINTS_IN_WORKER = 4;

/** Max login routes to display in worker prompt context. */
export const MAX_LOGIN_ROUTES_IN_WORKER = 3;

/** Max callback routes to display in worker prompt context. */
export const MAX_CALLBACK_ROUTES_IN_WORKER = 3;

/** Max breadcrumbs to keep in worker action history buffer. */
export const MAX_BREADCRUMBS = 8;

/** Max array elements to include when redacting/truncating arrays. */
export const MAX_REDACTED_ARRAY_ELEMENTS = 8;

/** Default string truncation length for redacted values. */
export const DEFAULT_REDACT_TRUNCATE_LENGTH = 320;

/** Shorter truncation length for specific redacted fields. */
export const SHORT_REDACT_TRUNCATE_LENGTH = 160;

/** Default LLM request timeout in milliseconds. */
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;

/** LLM judge request timeout in milliseconds. */
export const JUDGE_LLM_TIMEOUT_MS = 15_000;
