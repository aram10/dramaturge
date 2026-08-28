// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './utils/atomic-file.js';
import { FAILURE_SEVERITIES } from './severity.js';
import { FOCUS_MODES } from './config-inline.js';
import { PRESET_NAMES } from './presets.js';

const ProviderSchema = z.enum(['anthropic', 'openai', 'google', 'azure', 'openrouter', 'github']);
const OutputFormatSchema = z.enum(['markdown', 'json', 'both', 'junit', 'sarif']);

const CliPreferencesSchema = z
  .object({
    version: z.literal(1).default(1),
    provider: ProviderSchema.optional(),
    preset: z.enum(PRESET_NAMES).optional(),
    focusModes: z.array(z.enum(FOCUS_MODES)).optional(),
    formats: z.array(OutputFormatSchema).min(1).optional(),
    headless: z.boolean().optional(),
    scopeMode: z.enum(['all', 'diff']).optional(),
    diffBase: z.string().min(1).optional(),
    failOnSeverity: z.enum(FAILURE_SEVERITIES).optional(),
  })
  .strict();

export type CliPreferences = z.infer<typeof CliPreferencesSchema>;

export function getCliPreferencesPath(homeDir = homedir()): string {
  return join(homeDir, '.dramaturge', 'cli-config.json');
}

export function loadCliPreferences(path = getCliPreferencesPath()): CliPreferences {
  if (!existsSync(path)) return { version: 1 };
  try {
    return CliPreferencesSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return { version: 1 };
  }
}

export function saveCliPreferences(
  preferences: Omit<CliPreferences, 'version'>,
  path = getCliPreferencesPath()
): void {
  const validated = CliPreferencesSchema.parse({ version: 1, ...preferences });
  writeFileAtomic(path, `${JSON.stringify(validated, null, 2)}\n`);
}
