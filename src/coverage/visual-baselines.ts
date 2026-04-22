// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface BaselineFile {
  fileName: string;
  path: string;
  fingerprintHash: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  modifiedAt: string;
}

const BASELINE_NAME_PATTERN = /^(.+)-(\d+)x(\d+)\.png$/;

export function listBaselineFiles(baselineDir: string): BaselineFile[] {
  if (!existsSync(baselineDir)) {
    return [];
  }
  const entries = readdirSync(baselineDir).filter((name) => name.endsWith('.png'));
  const files: BaselineFile[] = [];
  for (const name of entries) {
    const fullPath = join(baselineDir, name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;

    const match = BASELINE_NAME_PATTERN.exec(name);
    files.push({
      fileName: name,
      path: fullPath,
      fingerprintHash: match ? match[1] : name.replace(/\.png$/, ''),
      width: match ? Number.parseInt(match[2], 10) : undefined,
      height: match ? Number.parseInt(match[3], 10) : undefined,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  }
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

export interface ApproveBaselinesResult {
  removed: BaselineFile[];
  notFound: string[];
}

/**
 * "Approve" baselines by removing them from disk so the next run captures a
 * fresh screenshot as the baseline. When `target` is `'all'`, every baseline
 * is removed; otherwise only baselines whose fingerprintHash or fileName
 * match one of the provided identifiers are removed.
 */
export function approveBaselines(
  baselineDir: string,
  target: 'all' | string[]
): ApproveBaselinesResult {
  const files = listBaselineFiles(baselineDir);
  if (target === 'all') {
    for (const file of files) {
      unlinkSync(file.path);
    }
    return { removed: files, notFound: [] };
  }

  const removed: BaselineFile[] = [];
  const notFound: string[] = [];
  const removedPaths = new Set<string>();
  for (const identifier of target) {
    const matches = files.filter(
      (file) => file.fingerprintHash === identifier || file.fileName === identifier
    );
    if (matches.length === 0) {
      notFound.push(identifier);
      continue;
    }
    for (const match of matches) {
      if (removedPaths.has(match.path)) {
        continue;
      }
      unlinkSync(match.path);
      removed.push(match);
      removedPaths.add(match.path);
    }
  }
  return { removed, notFound };
}
