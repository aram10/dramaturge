// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

export interface DiffFileEntry {
  /** Relative file path from repo root. */
  path: string;
  /** Change kind. */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

/**
 * Aggregated diff context produced by analysing a git diff against a base ref.
 * Consumers use `affectedRoutes` / `affectedApiEndpoints` to boost priority
 * and optionally restrict exploration scope.
 */
export interface DiffContext {
  /** The base ref the diff was computed against (e.g. "origin/main"). */
  baseRef: string;
  /** Raw list of changed files. */
  changedFiles: DiffFileEntry[];
  /** Routes whose source files were modified (matched via repo adapters). */
  affectedRoutes: string[];
  /** API endpoint route patterns whose handler files were modified. */
  affectedApiEndpoints: string[];
  /** Route families (parameterised patterns) affected by the diff. */
  affectedRouteFamilies: string[];
}
