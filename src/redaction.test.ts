import { describe, it, expect } from 'vitest';
import {
  truncateString,
  isSensitiveKey,
  sanitizeHeaders,
  stripRedactedHeaders,
  redactSensitiveValue,
  stripRedactedValue,
  REDACTED_VALUE,
} from './redaction.js';

describe('truncateString', () => {
  it('returns short strings unchanged', () => {
    expect(truncateString('hello')).toBe('hello');
  });

  it('returns a string exactly at default max unchanged', () => {
    const str = 'a'.repeat(320);
    expect(truncateString(str)).toBe(str);
  });

  it('truncates strings exceeding the default max of 320', () => {
    const str = 'a'.repeat(321);
    const result = truncateString(str);
    expect(result).toHaveLength(320);
    expect(result).toBe('a'.repeat(317) + '...');
  });

  it('handles an empty string', () => {
    expect(truncateString('')).toBe('');
  });

  it('truncates with a custom max length', () => {
    expect(truncateString('abcdefghij', 7)).toBe('abcd...');
  });

  it('returns string unchanged when length equals custom max', () => {
    expect(truncateString('abcde', 5)).toBe('abcde');
  });

  it('truncates to "..." when custom max is 3 and string exceeds it', () => {
    expect(truncateString('abcd', 3)).toBe('...');
  });
});

describe('isSensitiveKey', () => {
  describe('detects sensitive keys', () => {
    const sensitiveKeys = [
      'authorization',
      'Authorization',
      'AUTHORIZATION',
      'cookie',
      'Cookie',
      'cookies',
      'set-cookie',
      'Set-Cookie',
      'password',
      'secret',
      'token',
      'session',
      'api-key',
      'apikey',
      'csrf',
      'xsrf',
      'x-csrf-token',
      'x-xsrf-token',
      'auth',
    ];

    it.each(sensitiveKeys)('returns true for "%s"', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });
  });

  describe('detects camelCase sensitive keys', () => {
    const camelKeys = ['apiKey', 'authToken', 'sessionId', 'csrfToken', 'xsrfToken', 'accessToken'];

    it.each(camelKeys)('returns true for "%s"', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });
  });

  describe('detects snake_case sensitive keys', () => {
    const snakeKeys = [
      'api_key',
      'auth_token',
      'session_id',
      'csrf_token',
      'xsrf_token',
      'access_token',
    ];

    it.each(snakeKeys)('returns true for "%s"', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });
  });

  describe('returns false for non-sensitive keys', () => {
    const safeKeys = [
      'content-type',
      'Content-Type',
      'accept',
      'cache-control',
      'host',
      'user-agent',
      'x-request-id',
      'content-length',
      'name',
      'email',
      'url',
    ];

    it.each(safeKeys)('returns false for "%s"', (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    });
  });
});

describe('sanitizeHeaders', () => {
  it('redacts sensitive headers and truncates normal ones', () => {
    const headers: Record<string, string> = {
      Authorization: 'Bearer abc123',
      'Content-Type': 'application/json',
      Cookie: 'session=xyz',
      Accept: 'text/html',
    };
    const result = sanitizeHeaders(headers);
    expect(result['Authorization']).toBe(REDACTED_VALUE);
    expect(result['Cookie']).toBe(REDACTED_VALUE);
    expect(result['Content-Type']).toBe('application/json');
    expect(result['Accept']).toBe('text/html');
  });

  it('truncates long non-sensitive header values at SHORT_REDACT_TRUNCATE_LENGTH (160)', () => {
    const longValue = 'x'.repeat(200);
    const result = sanitizeHeaders({ 'X-Custom': longValue });
    expect(result['X-Custom']).toHaveLength(160);
    expect(result['X-Custom']).toBe('x'.repeat(157) + '...');
  });

  it('handles empty headers object', () => {
    expect(sanitizeHeaders({})).toEqual({});
  });

  it('preserves all header keys', () => {
    const headers: Record<string, string> = {
      Authorization: 'secret',
      'x-request-id': '12345',
    };
    const result = sanitizeHeaders(headers);
    expect(Object.keys(result)).toEqual(['Authorization', 'x-request-id']);
  });
});

describe('stripRedactedHeaders', () => {
  it('returns undefined for undefined input', () => {
    expect(stripRedactedHeaders(undefined)).toBeUndefined();
  });

  it('strips headers with sensitive keys', () => {
    const headers: Record<string, string> = {
      Authorization: 'Bearer xyz',
      'Content-Type': 'application/json',
      Cookie: 'session=abc',
    };
    const result = stripRedactedHeaders(headers);
    expect(result).toEqual({ 'Content-Type': 'application/json' });
  });

  it('strips headers whose value is REDACTED_VALUE', () => {
    const headers: Record<string, string> = {
      'X-Custom': REDACTED_VALUE,
      Accept: 'text/html',
    };
    const result = stripRedactedHeaders(headers);
    expect(result).toEqual({ Accept: 'text/html' });
  });

  it('returns undefined when all headers are stripped', () => {
    const headers: Record<string, string> = {
      Authorization: 'token',
      Cookie: 'value',
    };
    expect(stripRedactedHeaders(headers)).toBeUndefined();
  });

  it('returns undefined for an empty headers object', () => {
    expect(stripRedactedHeaders({})).toBeUndefined();
  });

  it('keeps non-sensitive headers with non-redacted values', () => {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
    };
    expect(stripRedactedHeaders(headers)).toEqual(headers);
  });
});

describe('redactSensitiveValue', () => {
  it('truncates long strings at SHORT_REDACT_TRUNCATE_LENGTH (160)', () => {
    const long = 'z'.repeat(200);
    const result = redactSensitiveValue(long) as string;
    expect(result).toHaveLength(160);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns short strings unchanged', () => {
    expect(redactSensitiveValue('hi')).toBe('hi');
  });

  it('passes through numbers', () => {
    expect(redactSensitiveValue(42)).toBe(42);
  });

  it('passes through booleans', () => {
    expect(redactSensitiveValue(true)).toBe(true);
    expect(redactSensitiveValue(false)).toBe(false);
  });

  it('passes through null', () => {
    expect(redactSensitiveValue(null)).toBeNull();
  });

  it('passes through undefined', () => {
    expect(redactSensitiveValue(undefined)).toBeUndefined();
  });

  it('truncates arrays to MAX_REDACTED_ARRAY_ELEMENTS (8)', () => {
    const arr = Array.from({ length: 12 }, (_, i) => i);
    const result = redactSensitiveValue(arr) as number[];
    expect(result).toHaveLength(8);
    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('recursively redacts array elements', () => {
    const arr = ['a'.repeat(200)];
    const result = redactSensitiveValue(arr) as string[];
    expect(result[0]).toHaveLength(160);
  });

  it('redacts sensitive keys in objects', () => {
    const obj = { password: 'secret123', name: 'Alice' };
    const result = redactSensitiveValue(obj) as Record<string, unknown>;
    expect(result['password']).toBe(REDACTED_VALUE);
    expect(result['name']).toBe('Alice');
  });

  it('recursively redacts nested objects', () => {
    const obj = {
      user: {
        token: 'abc',
        info: {
          email: 'user@example.com',
        },
      },
    };
    const result = redactSensitiveValue(obj) as Record<string, Record<string, unknown>>;
    expect(result['user']['token']).toBe(REDACTED_VALUE);
    expect((result['user']['info'] as Record<string, unknown>)['email']).toBe('user@example.com');
  });

  it('returns [Truncated] when depth exceeds 3', () => {
    const deepObj = { a: { b: { c: { d: 'deep' } } } };
    const result = redactSensitiveValue(deepObj) as Record<string, unknown>;
    const level1 = result['a'] as Record<string, unknown>;
    const level2 = level1['b'] as Record<string, unknown>;
    const level3 = level2['c'] as Record<string, unknown>;
    expect(level3['d']).toBe('[Truncated]');
  });

  it('handles mixed nested structure', () => {
    const obj = {
      items: [{ secret: 'val', label: 'ok' }],
      apiKey: 'hidden',
    };
    const result = redactSensitiveValue(obj) as Record<string, unknown>;
    expect(result['apiKey']).toBe(REDACTED_VALUE);
    const items = result['items'] as Record<string, unknown>[];
    expect(items[0]['secret']).toBe(REDACTED_VALUE);
    expect(items[0]['label']).toBe('ok');
  });
});

describe('stripRedactedValue', () => {
  it('returns undefined for REDACTED_VALUE', () => {
    expect(stripRedactedValue(REDACTED_VALUE)).toBeUndefined();
  });

  it('passes through non-redacted strings', () => {
    expect(stripRedactedValue('hello')).toBe('hello');
  });

  it('passes through numbers', () => {
    expect(stripRedactedValue(99)).toBe(99);
  });

  it('passes through booleans', () => {
    expect(stripRedactedValue(true)).toBe(true);
  });

  it('passes through null', () => {
    expect(stripRedactedValue(null)).toBeNull();
  });

  it('filters REDACTED_VALUE entries from arrays', () => {
    const arr = ['a', REDACTED_VALUE, 'b'];
    expect(stripRedactedValue(arr)).toEqual(['a', 'b']);
  });

  it('recursively strips redacted values from nested arrays', () => {
    const arr = [['inner', REDACTED_VALUE], 'outer'];
    expect(stripRedactedValue(arr)).toEqual([['inner'], 'outer']);
  });

  it('removes entries with sensitive keys from objects', () => {
    const obj = { name: 'Alice', password: 'secret', token: 'abc' };
    const result = stripRedactedValue(obj) as Record<string, unknown>;
    expect(result).toEqual({ name: 'Alice' });
  });

  it('removes entries whose value is REDACTED_VALUE from objects', () => {
    const obj = { name: 'Alice', flag: REDACTED_VALUE };
    const result = stripRedactedValue(obj) as Record<string, unknown>;
    expect(result).toEqual({ name: 'Alice' });
  });

  it('recursively strips from nested objects', () => {
    const obj = {
      user: {
        name: 'Bob',
        session: 'abc',
        meta: {
          role: 'admin',
          csrf: 'token123',
        },
      },
    };
    const result = stripRedactedValue(obj) as Record<string, Record<string, unknown>>;
    expect(result['user']['name']).toBe('Bob');
    expect(result['user']).not.toHaveProperty('session');
    const meta = result['user']['meta'] as Record<string, unknown>;
    expect(meta['role']).toBe('admin');
    expect(meta).not.toHaveProperty('csrf');
  });

  it('returns an empty object when all keys are sensitive', () => {
    const obj = { password: 'a', token: 'b', secret: 'c' };
    expect(stripRedactedValue(obj)).toEqual({});
  });

  it('handles arrays inside objects', () => {
    const obj = {
      data: ['keep', REDACTED_VALUE],
      authorization: 'gone',
    };
    const result = stripRedactedValue(obj) as Record<string, unknown>;
    expect(result).toEqual({ data: ['keep'] });
  });
});
