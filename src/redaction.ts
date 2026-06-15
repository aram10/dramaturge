// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import {
  DEFAULT_REDACT_TRUNCATE_LENGTH,
  SHORT_REDACT_TRUNCATE_LENGTH,
  MAX_REDACTED_ARRAY_ELEMENTS,
  ELLIPSIS,
  ELLIPSIS_LENGTH,
} from './constants.js';

export const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[Truncated]';

function normalizeSensitiveKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
}

export function truncateString(value: string, max = DEFAULT_REDACT_TRUNCATE_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - ELLIPSIS_LENGTH)}${ELLIPSIS}` : value;
}

const SENSITIVE_KEY_RE =
  /(^|-)authorization($|-)|(^|-)auth($|-)|(^|-)cookies?($|-)|(^|-)password($|-)|(^|-)secret($|-)|(^|-)token($|-)|(^|-)session($|-)|(^|-)api-key($|-)|(^|-)apikey($|-)|(^|-)csrf($|-)|(^|-)xsrf($|-)/;

// Concatenated, all-lowercase forms that the hyphen-delimited regex above misses
// (e.g. Django/PHP defaults). Matched as substrings against the raw lowercased key
// after stripping separators, so 'csrftoken', 'sessionid', 'phpsessid', etc. are caught.
const SENSITIVE_SUBSTRINGS = [
  'authorization',
  'password',
  'passwd',
  'pwd',
  'secret',
  'csrftoken',
  'xsrftoken',
  'sessionid',
  'sessid',
  'phpsessid',
  'privatekey',
  'accesskey',
  'apikey',
  'bearer',
];

function hasSensitiveSubstring(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return SENSITIVE_SUBSTRINGS.some((needle) => compact.includes(needle));
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(normalizeSensitiveKey(key)) || hasSensitiveSubstring(key);
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? REDACTED_VALUE : truncateString(value, SHORT_REDACT_TRUNCATE_LENGTH),
    ])
  );
}

export function stripRedactedHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const filtered = Object.fromEntries(
    Object.entries(headers).filter(
      ([key, value]) => !isSensitiveKey(key) && value !== REDACTED_VALUE
    )
  );

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export function redactSensitiveValue(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return TRUNCATED_VALUE;
  }

  if (typeof value === 'string') {
    return truncateString(value, SHORT_REDACT_TRUNCATE_LENGTH);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_REDACTED_ARRAY_ELEMENTS)
      .map((entry) => redactSensitiveValue(entry, depth + 1));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isSensitiveKey(key) ? REDACTED_VALUE : redactSensitiveValue(entry, depth + 1),
      ])
    );
  }

  return value;
}

export function stripRedactedValue(value: unknown): unknown {
  if (value === REDACTED_VALUE) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stripRedactedValue(entry)).filter((entry) => entry !== undefined);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
        if (isSensitiveKey(key)) {
          return [];
        }

        const next = stripRedactedValue(entry);
        if (next === undefined) {
          return [];
        }

        return [[key, next]];
      })
    );
  }

  return value;
}
