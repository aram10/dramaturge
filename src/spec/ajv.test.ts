import { describe, it, expect } from 'vitest';
import { validateJsonSchema } from './ajv.js';
import type { JsonSchema } from './types.js';

function makeObjectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

describe('validateJsonSchema', () => {
  it('returns ok:true with empty errors when schema is undefined', () => {
    const result = validateJsonSchema(undefined, { anything: 'goes' });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('validates a correct object against a schema', () => {
    const schema = makeObjectSchema(
      {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      ['name']
    );

    const result = validateJsonSchema(schema, { name: 'Alice', age: 30 });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns ok:false with errors for an invalid object', () => {
    const schema = makeObjectSchema(
      {
        name: { type: 'string' },
      },
      ['name']
    );

    const result = validateJsonSchema(schema, {});

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('handles nested object schemas', () => {
    const schema = makeObjectSchema(
      {
        user: makeObjectSchema(
          {
            email: { type: 'string' },
          },
          ['email']
        ),
      },
      ['user']
    );

    const valid = validateJsonSchema(schema, { user: { email: 'a@b.com' } });
    expect(valid.ok).toBe(true);

    const invalid = validateJsonSchema(schema, { user: {} });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.length).toBeGreaterThan(0);
  });

  it('caches validators so the same schema works on repeated calls', () => {
    const schema: JsonSchema = { type: 'number' };

    const first = validateJsonSchema(schema, 42);
    const second = validateJsonSchema(schema, 99);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const bad = validateJsonSchema(schema, 'not a number');
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});
