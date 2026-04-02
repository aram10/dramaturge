import { execSync } from "node:child_process";
import type { DiffFileEntry } from "./types.js";

/**
 * Status letter → DiffFileEntry["status"] mapping.
 * Git diff --name-status prefixes each line with a letter:
 *   A = added, M = modified, D = deleted, R### = renamed, C### = copied (treated as added).
 */
function statusFromLetter(letter: string): DiffFileEntry["status"] {
  if (letter === "A" || letter.startsWith("C")) return "added";
  if (letter === "M") return "modified";
  if (letter === "D") return "deleted";
  if (letter.startsWith("R")) return "renamed";
  return "modified";
}

/**
 * Parse the output of `git diff --name-status` into `DiffFileEntry[]`.
 *
 * Each non-empty line has the format:
 *   STATUS\tpath          (for A, M, D)
 *   STATUS\told-path\tnew-path  (for R, C)
 */
export function parseDiffNameStatus(raw: string): DiffFileEntry[] {
  const entries: DiffFileEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 2) continue;

    const statusLetter = parts[0];
    const status = statusFromLetter(statusLetter);

    // For renames / copies the *new* path is the relevant one.
    const path = parts.length >= 3 ? parts[2] : parts[1];
    entries.push({ path, status });
  }
  return entries;
}

/**
 * Run `git diff --name-status <baseRef>` in the given repo root
 * and return the parsed file entries.
 *
 * If the command fails (e.g. invalid ref, not a git repo) an empty
 * array is returned so callers can degrade gracefully.
 */
export function getChangedFiles(
  baseRef: string,
  repoRoot: string,
): DiffFileEntry[] {
  try {
    const output = execSync(`git diff --name-status ${baseRef}`, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return parseDiffNameStatus(output);
  } catch {
    return [];
  }
}
