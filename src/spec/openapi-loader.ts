// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseJsoncObject } from '../utils/jsonc.js';
import { buildOpenApiSpec } from './openapi-spec.js';
import type { NormalizedSpecArtifact } from './types.js';

export function loadOpenApiSpec(filePath: string): NormalizedSpecArtifact {
  const raw = readFileSync(filePath, 'utf-8');
  const extension = extname(filePath).toLowerCase();
  const parsed =
    extension === '.yaml' || extension === '.yml' ? parseYaml(raw) : parseJsoncObject(raw);
  return buildOpenApiSpec(parsed);
}
