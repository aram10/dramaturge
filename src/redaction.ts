const REDACTED_VALUE = "[REDACTED]";
const TRUNCATED_VALUE = "[Truncated]";

function normalizeSensitiveKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
}

export function truncateString(value: string, max = 320): string {
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
      isSensitiveKey(key) ? REDACTED_VALUE : truncateString(value, 160),
    ])
  );
}

export function redactSensitiveValue(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return TRUNCATED_VALUE;
  }

  if (typeof value === "string") {
    return truncateString(value, 160);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry) => redactSensitiveValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isSensitiveKey(key) ? REDACTED_VALUE : redactSensitiveValue(entry, depth + 1),
      ])
    );
  }

  return value;
}
