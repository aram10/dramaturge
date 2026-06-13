// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write a file atomically: the data is first written to a sibling temporary
 * file and then renamed into place. A crash mid-write therefore leaves the
 * destination either untouched or fully replaced, never half-written. The
 * parent directory is created if necessary.
 */
export function writeFileAtomic(path: string, data: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, data, 'utf-8');
    renameSync(tempPath, path);
  } catch (error) {
    // Best-effort cleanup of the temp file so we don't leak partial writes.
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // ignore cleanup failures
    }
    throw error;
  }
}
