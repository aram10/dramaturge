// SPDX-License-Identifier: Apache-2.0
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

/** Max retry attempts for transient (429 / 5xx / network) LLM request failures. */
export const MAX_LLM_RETRIES = 3;

/** Base delay (ms) for exponential backoff between retried LLM requests. */
export const LLM_RETRY_BASE_DELAY_MS = 500;

/** Cap (ms) on the exponential backoff delay between retried LLM requests. */
export const LLM_RETRY_MAX_DELAY_MS = 8000;

/** Priority decay factor applied when requeuing a failed/blocked frontier item. */
export const REQUEUE_PRIORITY_DECAY = 0.8;

/**
 * Max follow-up tasks a single node may spawn across the run. Caps self-sustaining
 * follow-up loops that would otherwise starve genuinely new exploration (#221).
 */
export const MAX_FOLLOWUPS_PER_NODE = 8;

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

/**
 * Maximum response/request body size (in characters) that will be JSON-parsed
 * when observing API traffic. Beyond this the raw text is truncated instead, so
 * a hostile server cannot force an unbounded JSON.parse (#233).
 */
export const MAX_BODY_PARSE_LENGTH = 100_000;

/** Default LLM request timeout in milliseconds. */
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;

/** LLM judge request timeout in milliseconds. */
export const JUDGE_LLM_TIMEOUT_MS = 15_000;

/** Visual diff ratio threshold used to classify changed surfaces. */
export const VISUAL_CHANGED_SURFACE_RATIO_THRESHOLD = 0.05;

/**
 * Minimum number of times a route must record sub-threshold visual jitter
 * before it is treated as flaky for cross-run classification (#230). A single
 * below-threshold pixel diff is not enough signal to suppress findings.
 */
export const MIN_FLAKY_PAGE_COUNT = 2;

// ---------------------------------------------------------------------------
// Planner priority scoring
// ---------------------------------------------------------------------------

/** Relative weights applied to each priority-scoring component in the planner. */
export const PRIORITY_WEIGHTS = {
  novelty: 0.3,
  risk: 0.2,
  coverageGap: 0.3,
  revisitPenalty: 0.2,
  apiGap: 0.1,
  diffApiGap: 0.05,
} as const;

/** Divisor used to compute the diminishing-returns revisit penalty (visits / N). */
export const REVISIT_PENALTY_DIVISOR = 3;

/** Flat priority adjustment for a single memory-derived signal (historical/flaky/suppression). */
export const MEMORY_SIGNAL_BOOST = 0.05;

/** Priority penalty applied to adversarial worker tasks so they run after coverage. */
export const ADVERSARIAL_WORKER_PENALTY = 0.2;

/** Default priority boost for state-graph nodes matching a detected diff (0-1). */
export const DEFAULT_DIFF_PRIORITY_BOOST = 0.3;

/** Priority for repo-aware navigation seed proposals. */
export const SEED_TASK_PRIORITY = 0.85;

/** Priority for API-contract follow-up proposals. */
export const API_PROPOSAL_PRIORITY = 0.78;

/** Priority for low-priority adversarial coverage proposals. */
export const ADVERSARIAL_PROPOSAL_PRIORITY = 0.35;

/** Priority boost for tasks matching a mission critical-flow pattern. */
export const CRITICAL_FLOW_PRIORITY_BOOST = 0.2;

/** Priority assigned to follow-up tasks routed from a finding. */
export const FOLLOWUP_TASK_PRIORITY = 0.8;

/** Minimum number of inputs before a page is classified as a form page. */
export const FORM_PAGE_MIN_INPUTS = 3;

/** Priority above which a blind-spot item is reported as high severity. */
export const BLIND_SPOT_HIGH_PRIORITY_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// A2A blackboard / messaging / dashboard
// ---------------------------------------------------------------------------

/** Number of recent blackboard entries to include in worker/agent context. */
export const BLACKBOARD_SUMMARY_LIMIT = 10;

/** Default number of recent blackboard entries shown by `Blackboard.summarize()`. */
export const DEFAULT_BLACKBOARD_SUMMARY_ENTRIES = 20;

/** Max characters of a serialized blackboard entry shown in event summaries. */
export const BLACKBOARD_ENTRY_MAX_LEN = 60;

/** Max characters of a blackboard entry data preview in `Blackboard.summarize()`. */
export const BLACKBOARD_PREVIEW_MAX_LEN = 80;

/** Max characters of A2A message text shown in event summaries. */
export const A2A_MESSAGE_TEXT_MAX_LEN = 80;

/** Width (in cells) of the terminal dashboard progress bar. */
export const PROGRESS_BAR_WIDTH = 20;

/** Number of hex characters retained from a page fingerprint hash. */
export const FINGERPRINT_HASH_LEN = 12;

// ---------------------------------------------------------------------------
// Worker prompts / page stability
// ---------------------------------------------------------------------------

/** Max contract-expectation summaries to include in worker prompt context. */
export const MAX_CONTRACT_SUMMARIES_IN_WORKER = 6;

/** Max observed API endpoints to include in worker prompt context. */
export const MAX_OBSERVED_API_IN_WORKER = 6;

/** Default timeout (ms) for the DOM page-stability checker. */
export const PAGE_STABILITY_TIMEOUT_MS = 5000;

/** Period (ms) of DOM quiet required before a page is considered stable. */
export const DOM_QUIET_MS = 300;

/** Extra buffer (ms) added to the page-stability race fallback. */
export const PAGE_STABILITY_BUFFER_MS = 1000;

/** Max bootstrap process log lines retained for failure diagnostics. */
export const BOOTSTRAP_LOG_LIMIT = 20;

/** Default timeout (ms) for each bootstrap readiness probe request. */
export const DEFAULT_BOOTSTRAP_READY_TIMEOUT_MS = 5_000;

/** Default interval (ms) between bootstrap readiness polls. */
export const BOOTSTRAP_POLL_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Coverage (visual / vision / accessibility)
// ---------------------------------------------------------------------------

/** Visual diff ratio at or above which a change is classified Critical. */
export const VISUAL_CRITICAL_RATIO = 0.25;

/** Visual diff ratio at or above which a change is classified Minor. */
export const VISUAL_MINOR_RATIO = 0.01;

/** Max characters of layout description retained from a failed vision parse. */
export const VISION_LAYOUT_DESC_MAX_LEN = 500;

/** Max visible components listed in a vision analysis summary. */
export const VISION_MAX_COMPONENTS = 10;

/** Max selectors listed in an accessibility violation summary. */
export const A11Y_MAX_SELECTORS = 3;

// ---------------------------------------------------------------------------
// API probing / correlation / HTTP status
// ---------------------------------------------------------------------------

/** HTTP status for rate limiting (transient, retryable). */
export const HTTP_RATE_LIMITED = 429;

/** Minimum HTTP status considered a server error. */
export const HTTP_SERVER_ERROR_MIN = 500;

/** Correlation score boost when a page token prefix-matches a route. */
export const API_PREFIX_BOOST = 0.25;

/** Correlation score boost when an operation requires authentication. */
export const API_AUTH_BOOST = 0.1;

/** Max recent API probe failure messages surfaced in diagnostics. */
export const MAX_DIAGNOSTICS_FAILURES_SHOWN = 3;

/** Default minimum HTTP status treated as a network error during replay. */
export const DEFAULT_NETWORK_ERROR_MIN_STATUS = 400;

// ---------------------------------------------------------------------------
// LLM token / priority defaults
// ---------------------------------------------------------------------------

/** Max tokens requested for planner proposal completions. */
export const LLM_PROPOSAL_MAX_TOKENS = 1024;

/** Default priority assigned to a proposal lacking an explicit numeric priority. */
export const DEFAULT_PROPOSAL_PRIORITY = 0.5;

/** Max tokens requested for judge completions. */
export const JUDGE_MAX_TOKENS = 512;

// ---------------------------------------------------------------------------
// Finding quality scoring
// ---------------------------------------------------------------------------

/** Points awarded per finding-quality component. */
export const QUALITY_WEIGHTS = {
  hasUrl: 10,
  hasReproActions: 25,
  hasExpectedActual: 15,
  hasScreenshot: 10,
  hasNetworkOrConsole: 10,
  hasA11ySource: 5,
  confirmationFixed: 10,
  confidenceHigh: 15,
  confidenceMedium: 10,
} as const;

/** Default total quality points above which a finding is promotable. */
export const DEFAULT_PROMOTABLE_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// Adversarial / memory / diff / repro
// ---------------------------------------------------------------------------

/** Length of the repeated-character boundary-text adversarial payload. */
export const ADVERSARIAL_BOUNDARY_TEXT_LEN = 256;

/** Max recent routes retained per finding-history record. */
export const MEMORY_MAX_RECENT_ROUTES = 8;

/** Max API hints returned when ranking memory-derived API endpoints. */
export const MEMORY_MAX_API_HINTS = 4;

/** Timeout (ms) for the `git diff` subprocess used in diff-aware exploration. */
export const GIT_DIFF_TIMEOUT_MS = 30_000;

/** Timeout (ms) to wait for network idle when settling a replayed page. */
export const REPLAY_SETTLE_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// Auth timeouts / attempts
// ---------------------------------------------------------------------------

/** Delay (ms) after a detected login before saving browser state. */
export const AUTH_SETTLE_DELAY_MS = 5000;

/** Default max confirmation attempts when capturing auth state interactively. */
export const MAX_AUTH_CONFIRM_ATTEMPTS = 3;

/** Default timeout (ms) when polling for a success indicator. */
export const SUCCESS_POLL_TIMEOUT_MS = 30_000;

/** Interval (ms) between success-indicator polls. */
export const SUCCESS_POLL_INTERVAL_MS = 500;

/** Timeout (ms) for validating cached auth state before manual fallback. */
export const CACHED_AUTH_VALIDATION_TIMEOUT_MS = 10_000;

/** Milliseconds per second (unit conversion for human-readable durations). */
export const MS_PER_SECOND = 1000;

// ---------------------------------------------------------------------------
// Report display caps
// ---------------------------------------------------------------------------

/** Max workflow anomalies listed in a Markdown report. */
export const MAX_ANOMALIES_IN_REPORT = 12;

/** Max safety-audit entries listed in a Markdown report. */
export const MAX_AUDIT_ENTRIES_IN_REPORT = 10;
