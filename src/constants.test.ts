import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

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

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(),
}));

describe('shortId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the first 8 characters of a UUID', () => {
    vi.mocked(randomUUID).mockReturnValue('abcd1234-5678-90ef-abcd-1234567890ab');
    expect(shortId()).toBe('abcd1234');
  });

  it('returns an 8-character string', () => {
    vi.mocked(randomUUID).mockReturnValue('deadbeef-0000-1111-2222-333344445555');
    const id = shortId();
    expect(id).toHaveLength(8);
  });

  it('matches the UUID hex pattern', () => {
    vi.mocked(randomUUID).mockReturnValue('01234567-89ab-cdef-0123-456789abcdef');
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
