import type { RepoHints, ApiEndpointHint } from "../adaptation/types.js";
import type { DiffContext, DiffFileEntry } from "./types.js";
import { getChangedFiles } from "./diff-parser.js";

/**
 * Build a DiffContext by running `git diff` against `baseRef` and matching
 * the changed files against the provided `RepoHints`.
 *
 * If `repoHints` is not available the context will still contain the raw
 * changed-files list — priority boosting will just be limited to
 * path-based heuristics.
 */
export function buildDiffContext(
  baseRef: string,
  repoRoot: string,
  repoHints?: RepoHints,
): DiffContext {
  const changedFiles = getChangedFiles(baseRef, repoRoot);
  return buildDiffContextFromFiles(baseRef, changedFiles, repoHints);
}

/**
 * Pure-function variant that accepts pre-parsed file entries.
 * Easier to test because it doesn't shell out to git.
 */
export function buildDiffContextFromFiles(
  baseRef: string,
  changedFiles: DiffFileEntry[],
  repoHints?: RepoHints,
): DiffContext {
  if (!repoHints || changedFiles.length === 0) {
    return {
      baseRef,
      changedFiles,
      affectedRoutes: [],
      affectedApiEndpoints: [],
      affectedRouteFamilies: [],
    };
  }

  const affectedRoutes = matchRoutes(changedFiles, repoHints.routes);
  const affectedApiEndpoints = matchApiEndpoints(changedFiles, repoHints.apiEndpoints);
  const affectedRouteFamilies = matchRouteFamilies(changedFiles, repoHints.routeFamilies);

  return {
    baseRef,
    changedFiles,
    affectedRoutes: unique(affectedRoutes),
    affectedApiEndpoints: unique(affectedApiEndpoints),
    affectedRouteFamilies: unique(affectedRouteFamilies),
  };
}

/**
 * Check whether a `StateNode` (identified by its URL) sits within the
 * diff-affected scope.  Used by the priority system and the finding tagger.
 */
export function isNodeAffectedByDiff(
  nodeUrl: string | undefined,
  diff: DiffContext,
): boolean {
  if (!nodeUrl) return false;

  let pathname: string;
  try {
    pathname = new URL(nodeUrl).pathname;
  } catch {
    pathname = nodeUrl;
  }

  const normalised = normalisePath(pathname);

  for (const route of diff.affectedRoutes) {
    if (routeMatchesPath(route, normalised)) return true;
  }
  for (const endpoint of diff.affectedApiEndpoints) {
    if (routeMatchesPath(endpoint, normalised)) return true;
  }
  for (const family of diff.affectedRouteFamilies) {
    if (normalised.startsWith(normalisePath(family))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalisePath(p: string): string {
  return ("/" + p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "")).toLowerCase();
}

/**
 * Convert a parameterised route pattern (e.g. `/users/:id`) into a regex
 * that matches concrete paths like `/users/42`.
 */
function routeToRegex(route: string): RegExp {
  // Split on parameter-like segments, escape the literal parts, rejoin
  const PARAM_RE = /:[a-zA-Z_]\w*|\[\.\.\.[\w]*\]|\[[\w]+\]/g;
  let pattern = "";
  let lastIndex = 0;

  for (const m of route.matchAll(PARAM_RE)) {
    // Escape the literal part before this param
    pattern += escapeRegex(route.slice(lastIndex, m.index));
    // Replace param with a wildcard
    pattern += m[0].startsWith("[...") ? ".*" : "[^/]+";
    lastIndex = m.index! + m[0].length;
  }
  // Escape remaining literal tail
  pattern += escapeRegex(route.slice(lastIndex));

  return new RegExp(`^${pattern}$`, "i");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeMatchesPath(route: string, path: string): boolean {
  const normRoute = normalisePath(route);
  if (normRoute === path) return true;
  return routeToRegex(normRoute).test(path);
}

/**
 * Heuristic: does a changed file "belong" to a given route?
 *
 * Examples:
 *   file: `src/pages/dashboard/index.tsx`  route: `/dashboard`   → match
 *   file: `app/api/users/route.ts`         route: `/api/users`   → match
 *   file: `app/users/[id]/page.tsx`        route: `/users/:id`   → match
 *   file: `server/routes/users.py`         route: `/api/users`   → match
 */
function fileMatchesRoute(filePath: string, route: string): boolean {
  const normalised = normalisePath(route);
  const segments = normalised.split("/").filter(Boolean);
  if (segments.length === 0) return false;

  // Strip parameter markers for file-matching
  const routeTokens = segments
    .filter((seg) => !seg.startsWith(":") && !seg.startsWith("["))
    .map((seg) => seg.toLowerCase());

  if (routeTokens.length === 0) return true; // route is purely params → any file matches

  const fileNorm = filePath.toLowerCase().replace(/\\/g, "/");

  // All non-parameter route tokens must appear as path segments in the file
  return routeTokens.every((token) => fileNorm.includes(`/${token}`) || fileNorm.includes(`${token}/`) || fileNorm.includes(`${token}.`));
}

function matchRoutes(files: DiffFileEntry[], routes: string[]): string[] {
  const matched: string[] = [];
  for (const route of routes) {
    for (const file of files) {
      if (fileMatchesRoute(file.path, route)) {
        matched.push(route);
        break;
      }
    }
  }
  return matched;
}

function matchApiEndpoints(
  files: DiffFileEntry[],
  endpoints: ApiEndpointHint[],
): string[] {
  const matched: string[] = [];
  for (const endpoint of endpoints) {
    for (const file of files) {
      if (fileMatchesRoute(file.path, endpoint.route)) {
        matched.push(endpoint.route);
        break;
      }
    }
  }
  return matched;
}

function matchRouteFamilies(files: DiffFileEntry[], families: string[]): string[] {
  const matched: string[] = [];
  for (const family of families) {
    for (const file of files) {
      if (fileMatchesRoute(file.path, family)) {
        matched.push(family);
        break;
      }
    }
  }
  return matched;
}
