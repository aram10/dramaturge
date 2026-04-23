// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcRoot = join(repoRoot, 'src');

function hasPathSegment(path: string, segment: string): boolean {
  return path.split(/[/\\]+/u).includes(segment);
}

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (hasPathSegment(fullPath, 'fixtures')) {
        continue;
      }
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (
      !['.ts', '.tsx'].includes(extname(entry.name)) ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx')
    ) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function relativeImportTargets(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf-8');
  const matches = source.matchAll(/from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g);
  return [...matches].map((match) => {
    const relativeTarget = match[1] ?? match[2];
    const target = resolve(dirname(filePath), relativeTarget);
    if (target.endsWith('.js')) {
      return target.replace(/\.js$/u, '.ts');
    }
    if (target.endsWith('.jsx')) {
      return target.replace(/\.jsx$/u, '.tsx');
    }
    return target;
  });
}

function classifyLayer(filePath: string): string {
  const relPath = relative(srcRoot, filePath).replaceAll('\\', '/');

  if (
    relPath === 'cli.ts' ||
    relPath.startsWith('bin/') ||
    relPath.startsWith('commands/') ||
    relPath.startsWith('action/')
  ) {
    return 'cli';
  }
  if (relPath === 'config.ts' || relPath.startsWith('config-') || relPath === 'env.ts') {
    return 'config';
  }
  if (
    relPath === 'engine.ts' ||
    relPath === 'checkpoint.ts' ||
    relPath === 'browser-errors.ts' ||
    relPath.startsWith('engine/') ||
    relPath.startsWith('planner/') ||
    relPath.startsWith('graph/') ||
    relPath.startsWith('worker/')
  ) {
    return 'orchestration';
  }
  if (relPath === 'types.ts' || relPath === 'constants.ts' || relPath === 'redaction.ts') {
    return 'domain';
  }
  if (relPath.startsWith('report/') || relPath.startsWith('dashboard/')) {
    return 'presentation';
  }
  return 'adapter';
}

const disallowedDependencies: Record<string, string[]> = {
  config: ['cli', 'orchestration', 'presentation'],
  orchestration: ['cli'],
  presentation: ['cli'],
};

describe('architecture boundaries', () => {
  it('detects fixture path segments portably', () => {
    expect(hasPathSegment('/repo/src/adaptation/fixtures', 'fixtures')).toBe(true);
    expect(hasPathSegment('/repo/src/adaptation/fixtures/nextjs/app.ts', 'fixtures')).toBe(true);
    expect(hasPathSegment('C:\\repo\\src\\adaptation\\fixtures\\app.ts', 'fixtures')).toBe(true);
    expect(hasPathSegment('/repo/src/adaptation/fixture-data/app.ts', 'fixtures')).toBe(false);
  });

  it('enforces the documented layer dependency rules', () => {
    const violations: string[] = [];

    for (const filePath of listSourceFiles(srcRoot)) {
      const sourceLayer = classifyLayer(filePath);
      const disallowedLayers = disallowedDependencies[sourceLayer] ?? [];

      for (const targetPath of relativeImportTargets(filePath)) {
        const targetLayer = classifyLayer(targetPath);
        if (disallowedLayers.includes(targetLayer)) {
          violations.push(
            `${relative(srcRoot, filePath)} must not depend on ${targetLayer} (${relative(srcRoot, targetPath)})`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
