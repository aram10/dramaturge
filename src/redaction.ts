import {
  DEFAULT_REDACT_TRUNCATE_LENGTH,
  SHORT_REDACT_TRUNCATE_LENGTH,
  MAX_REDACTED_ARRAY_ELEMENTS,
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
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return (
    /(^|-)authorization($|-)/.test(normalized) ||
    /(^|-)auth($|-)/.test(normalized) ||
    /(^|-)cookie(s)?($|-)/.test(normalized) ||
    /(^|-)password($|-)/.test(normalized) ||
    /(^|-)secret($|-)/.test(normalized) ||
    /(^|-)token($|-)/.test(normalized) ||
    /(^|-)session($|-)/.test(normalized) ||
    /(^|-)api-key($|-)/.test(normalized) ||
    /(^|-)apikey($|-)/.test(normalized) ||
    /(^|-)csrf($|-)/.test(normalized) ||
    /(^|-)xsrf($|-)/.test(normalized)
  );
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
