// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { readFileSync, statSync } from 'node:fs';

export const DEFAULT_SCAN_FILE_SIZE_LIMIT_BYTES = 1024 * 1024;

export function formatScanSizeLimit(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MiB`;
  }
  if (bytes % 1024 === 0) {
    return `${bytes / 1024} KiB`;
  }
  return `${bytes} bytes`;
}

export function readTextFileWithinLimit(
  filePath: string,
  maxBytes = DEFAULT_SCAN_FILE_SIZE_LIMIT_BYTES
): string | null {
  try {
    const stats = statSync(filePath);
    if (stats.size > maxBytes) {
      return null;
    }

    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
