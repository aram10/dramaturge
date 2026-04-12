import { describe, it, expect } from 'vitest';

import {
  shortId,
  TRUNCATE_GROUP_KEY,
  TRUNCATE_SUMMARY,
  TRUNCATE_TITLE,
  TRUNCATE_MERMAID_LABEL,
  MAX_NAV_RETRIES,
  REQUEUE_PRIORITY_DECAY,
  NAV_SETTLE_DELAY_MS,
  FINDING_ID_PAD,
  MAX_ROUTES_IN_PLANNER,
  MAX_ROUTE_FAMILIES_IN_PLANNER,
  MAX_STABLE_SELECTORS_IN_PLANNER,
  MAX_API_ENDPOINTS_IN_PLANNER,
  MAX_LOGIN_ROUTES_IN_PLANNER,
  MAX_ROUTES_IN_WORKER,
  MAX_ROUTE_FAMILIES_IN_WORKER,
  MAX_STABLE_SELECTORS_IN_WORKER,
  MAX_API_ENDPOINTS_IN_WORKER,
  MAX_LOGIN_ROUTES_IN_WORKER,
  MAX_CALLBACK_ROUTES_IN_WORKER,
  MAX_BREADCRUMBS,
  MAX_REDACTED_ARRAY_ELEMENTS,
  DEFAULT_REDACT_TRUNCATE_LENGTH,
  SHORT_REDACT_TRUNCATE_LENGTH,
  DEFAULT_LLM_TIMEOUT_MS,
  JUDGE_LLM_TIMEOUT_MS,
} from './constants.js';

describe('shortId', () => {
  it('returns an 8-character string', () => {
    const id = shortId();
    expect(id).toHaveLength(8);
  });

  it('returns a unique value on each call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => shortId()));
    expect(ids.size).toBe(50);
  });

  it('matches the UUID hex pattern', () => {
    const id = shortId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('exported constants', () => {
  const constants: Record<string, number> = {
    TRUNCATE_GROUP_KEY,
    TRUNCATE_SUMMARY,
    TRUNCATE_TITLE,
    TRUNCATE_MERMAID_LABEL,
    MAX_NAV_RETRIES,
    REQUEUE_PRIORITY_DECAY,
    NAV_SETTLE_DELAY_MS,
    FINDING_ID_PAD,
    MAX_ROUTES_IN_PLANNER,
    MAX_ROUTE_FAMILIES_IN_PLANNER,
    MAX_STABLE_SELECTORS_IN_PLANNER,
    MAX_API_ENDPOINTS_IN_PLANNER,
    MAX_LOGIN_ROUTES_IN_PLANNER,
    MAX_ROUTES_IN_WORKER,
    MAX_ROUTE_FAMILIES_IN_WORKER,
    MAX_STABLE_SELECTORS_IN_WORKER,
    MAX_API_ENDPOINTS_IN_WORKER,
    MAX_LOGIN_ROUTES_IN_WORKER,
    MAX_CALLBACK_ROUTES_IN_WORKER,
    MAX_BREADCRUMBS,
    MAX_REDACTED_ARRAY_ELEMENTS,
    DEFAULT_REDACT_TRUNCATE_LENGTH,
    SHORT_REDACT_TRUNCATE_LENGTH,
    DEFAULT_LLM_TIMEOUT_MS,
    JUDGE_LLM_TIMEOUT_MS,
  };

  it.each(Object.entries(constants))('%s is a positive number', (_name, value) => {
    expect(typeof value).toBe('number');
    expect(value).toBeGreaterThan(0);
  });
});
