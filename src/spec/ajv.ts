// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { createRequire } from 'node:module';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { JsonSchema } from './types.js';

const require = createRequire(import.meta.url);
type AjvConstructor = new (options?: Record<string, unknown>) => {
  compile: (schema: JsonSchema) => ValidateFunction;
};
const Ajv2020 = require('ajv/dist/2020').default as AjvConstructor;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

/**
 * Bounded compiled-validator cache. Each distinct schema (keyed by its JSON
 * serialization) compiles once; the least-recently-used entry is evicted when
 * the cache is full so a long run probing many endpoints can't grow it without
 * bound (#254).
 */
const MAX_VALIDATOR_CACHE_ENTRIES = 256;
const validatorCache = new Map<string, ValidateFunction>();

function getCachedValidator(cacheKey: string): ValidateFunction | undefined {
  const cached = validatorCache.get(cacheKey);
  if (cached) {
    // Refresh recency: re-insert so it moves to the end of the Map's order.
    validatorCache.delete(cacheKey);
    validatorCache.set(cacheKey, cached);
  }
  return cached;
}

function setCachedValidator(cacheKey: string, validator: ValidateFunction): void {
  validatorCache.set(cacheKey, validator);
  if (validatorCache.size > MAX_VALIDATOR_CACHE_ENTRIES) {
    const oldest = validatorCache.keys().next().value;
    if (oldest !== undefined) {
      validatorCache.delete(oldest);
    }
  }
}

function formatError(error: ErrorObject): string {
  const instancePath = error.instancePath || '/';
  return `${instancePath} ${error.message ?? 'validation failed'}`.trim();
}

export function validateJsonSchema(
  schema: JsonSchema | undefined,
  value: unknown
): { ok: boolean; errors: string[] } {
  if (!schema) {
    return {
      ok: true,
      errors: [],
    };
  }

  const cacheKey = JSON.stringify(schema);
  let validator = getCachedValidator(cacheKey);
  if (!validator) {
    try {
      validator = ajv.compile(schema);
    } catch {
      // Defensive: a schema with an unresolvable $ref (or otherwise invalid)
      // must not throw and turn an entire probe into a false failure. Treat an
      // uncompilable schema as "cannot validate" → no violation reported (#210).
      return { ok: true, errors: [] };
    }
    setCachedValidator(cacheKey, validator);
  }

  const ok = validator(value);
  return {
    ok,
    errors: ok ? [] : (validator.errors ?? []).map((error: ErrorObject) => formatError(error)),
  };
}
