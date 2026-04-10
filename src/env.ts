// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parse a `.env` file body into key-value pairs.
 * Supports blank lines, `#` comments, optional `export` prefix,
 * single/double quoted values, and inline comments after unquoted values.
 */
export function parseDotenv(body: string): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Strip optional leading `export `
    const stripped = line.startsWith('export ') ? line.slice(7).trimStart() : line;

    const eqIdx = stripped.indexOf('=');
    if (eqIdx < 1) continue;

    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip inline comment for unquoted values
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) {
        value = value.slice(0, hashIdx).trimEnd();
      }
    }

    vars[key] = value;
  }

  return vars;
}

/**
 * Load a `.env` file from the given directory (default: `process.cwd()`)
 * and merge its variables into `process.env` without overwriting existing values.
 *
 * Returns the number of new variables injected.
 */
export function loadDotenv(dir?: string): number {
  const envPath = resolve(dir ?? process.cwd(), '.env');
  if (!existsSync(envPath)) return 0;

  let body: string;
  try {
    body = readFileSync(envPath, 'utf-8');
  } catch {
    return 0;
  }

  const vars = parseDotenv(body);
  let injected = 0;
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      injected++;
    }
  }
  return injected;
}
