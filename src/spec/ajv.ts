// SPDX-License-Identifier: GPL-3.0-only
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

const validatorCache = new Map<string, ValidateFunction>();

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
  const validator =
    validatorCache.get(cacheKey) ??
    (() => {
      const compiled = ajv.compile(schema);
      validatorCache.set(cacheKey, compiled);
      return compiled;
    })();

  const ok = validator(value);
  return {
    ok,
    errors: ok ? [] : (validator.errors ?? []).map((error: ErrorObject) => formatError(error)),
  };
}
