// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from './types.js';
import { readTextFileWithinLimit } from './file-utils.js';

const ROUTE_FILE_RE = /\.(?:tsx?|jsx?)$/;
const SELECTOR_RE = /\b(id|data-testid)\s*=\s*["'`]([^"'`]+)["'`]/g;
const STATUS_JSON_RE = /json\s*\([^)]*\{\s*status\s*:\s*(\d{3})\s*\}/g;
const STATUS_RESPONSE_RE = /new\s+Response\s*\([^)]*\{\s*status\s*:\s*(\d{3})\s*\}/g;
const STATUS_THROW_RE = /throw\s+new\s+Response\s*\([^)]*\{\s*status\s*:\s*(\d{3})\s*\}/g;
const LOADER_RE = /\bexport\s+(?:async\s+)?function\s+loader\b/;
const ACTION_RE = /\bexport\s+(?:async\s+)?function\s+action\b/;
const DEFAULT_EXPORT_RE = /\bexport\s+default\s+function\b/;
const AUTH_RE = /\b(requireUser|requireAuth|getSession|assertRole|unauthorized|forbidden)\b/;
const VALIDATION_SCHEMA_RE = /\b([A-Z][A-Za-z0-9]+Schema)\b/g;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
]);

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

function walkFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeRoute(routePath: string): string {
  const normalized = routePath.replace(/\/+$/g, '');
  return normalized || '/';
}

function routeFamily(routePath: string): string {
  const [pathname] = routePath.split('?');
  if (!pathname || pathname === '/') return '/';
  const segments = pathname.split('/').filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : '/';
}

/**
 * Convert a Remix flat-file route filename to a URL path.
 *
 * Rules:
 *  - Dots separate path segments (`.` → `/`)
 *  - `$param` → `:param`
 *  - `_index` at the end → index route (removed)
 *  - Leading `_` prefix on a segment → pathless layout (ignored)
 */
function routeFromFileName(fileName: string): string {
  // Strip extension
  const withoutExt = fileName.replace(/\.[^.]+$/, '');

  // Split on dots to get segments
  const rawSegments = withoutExt.split('.');

  const segments: string[] = [];
  for (const seg of rawSegments) {
    // _index at the end means index route
    if (seg === '_index') continue;

    // Leading underscore = pathless layout segment → skip
    if (seg.startsWith('_')) continue;

    // $param → :param
    if (seg.startsWith('$')) {
      segments.push(`:${seg.slice(1)}`);
    } else {
      segments.push(seg);
    }
  }

  return normalizeRoute(`/${segments.join('/')}`);
}

function extractStableSelectors(content: string): string[] {
  const selectors: string[] = [];
  for (const match of content.matchAll(SELECTOR_RE)) {
    const [, attr, value] = match;
    if (attr === 'id') {
      selectors.push(`#${value}`);
    } else {
      selectors.push(`[data-testid="${value}"]`);
    }
  }
  return selectors;
}

function extractStatusCodes(content: string): number[] {
  const raw = [
    ...[...content.matchAll(STATUS_JSON_RE)].map((m) => m[1]),
    ...[...content.matchAll(STATUS_RESPONSE_RE)].map((m) => m[1]),
    ...[...content.matchAll(STATUS_THROW_RE)].map((m) => m[1]),
  ];
  return [...new Set(raw)].map((s) => Number.parseInt(s, 10)).sort((a, b) => a - b);
}

function extractMethods(content: string): string[] {
  const methods: string[] = [];
  if (LOADER_RE.test(content)) methods.push('GET');
  if (ACTION_RE.test(content)) methods.push('POST');
  return methods;
}

export function canScanRemixRepo(root: string): boolean {
  const resolvedRoot = resolve(root);

  if (existsSync(join(resolvedRoot, 'remix.config.js'))) {
    return true;
  }
  if (existsSync(join(resolvedRoot, 'remix.config.ts'))) {
    return true;
  }

  // Check for @remix-run/ imports in source files
  try {
    const appDir = join(resolvedRoot, 'app');
    if (!existsSync(appDir)) return false;

    const files = walkFiles(appDir);
    for (const filePath of files) {
      if (!ROUTE_FILE_RE.test(filePath)) continue;
      const content = readTextFileWithinLimit(filePath) ?? '';
      if (content.includes('@remix-run/')) return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export function scanRemixRepo(root: string): RepoHints {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);

  const routesDir = join(resolvedRoot, 'app', 'routes');

  // Categorize files
  const routeFiles: string[] = [];
  const allSourceFiles: string[] = []; // for selector extraction

  for (const filePath of allFiles) {
    const rel = toPosix(relative(resolvedRoot, filePath));

    if (!ROUTE_FILE_RE.test(filePath)) continue;

    if (rel.startsWith('app/routes/') && !rel.slice('app/routes/'.length).includes('/')) {
      routeFiles.push(filePath);
    }

    if (rel.startsWith('app/')) {
      allSourceFiles.push(filePath);
    }
  }

  // Process route files
  const pageRoutes: string[] = [];
  const apiEndpointMap = new Map<
    string,
    { methods: string[]; statuses: number[]; authRequired: boolean; validationSchemas: string[] }
  >();

  for (const filePath of routeFiles) {
    const fileName = toPosix(relative(routesDir, filePath));
    const content = readTextFileWithinLimit(filePath) ?? '';
    const route = routeFromFileName(fileName);
    const isPage = DEFAULT_EXPORT_RE.test(content);
    const hasLoader = LOADER_RE.test(content);
    const hasAction = ACTION_RE.test(content);

    if (isPage) {
      pageRoutes.push(route);
    }

    // Resource route (no default export but has loader/action) → API endpoint
    if (!isPage && (hasLoader || hasAction)) {
      const methods = extractMethods(content);
      const statuses = extractStatusCodes(content);
      const authRequired = AUTH_RE.test(content);
      const validationSchemas = uniqueSorted(
        [...content.matchAll(VALIDATION_SCHEMA_RE)].map((m) => m[1])
      );

      const existing = apiEndpointMap.get(route);
      if (existing) {
        existing.methods = uniqueSorted([...existing.methods, ...methods]);
        existing.statuses = [...new Set([...existing.statuses, ...statuses])].sort((a, b) => a - b);
        existing.authRequired = existing.authRequired || authRequired;
        existing.validationSchemas = uniqueSorted([
          ...existing.validationSchemas,
          ...validationSchemas,
        ]);
      } else {
        apiEndpointMap.set(route, {
          methods: uniqueSorted(methods),
          statuses,
          authRequired,
          validationSchemas,
        });
      }
    }

    // Page routes with loader/action that also have auth → noise
    if (isPage && (hasLoader || hasAction)) {
      // Still track as potential noise source — handled below
    }
  }

  const apiRoutes = [...apiEndpointMap.keys()];
  const apiEndpoints: ApiEndpointHint[] = [...apiEndpointMap.entries()]
    .map(([route, info]) => ({
      route,
      methods: info.methods,
      statuses: info.statuses,
      authRequired: info.authRequired,
      validationSchemas: info.validationSchemas,
    }))
    .sort((a, b) => a.route.localeCompare(b.route));

  // Combine all routes
  const routes = uniqueSorted([...pageRoutes, ...apiRoutes]);
  const routeFamilies = uniqueSorted(routes.map(routeFamily));

  // Extract selectors from all app source files
  const stableSelectors = uniqueSorted(
    allSourceFiles.flatMap((filePath) =>
      extractStableSelectors(readTextFileWithinLimit(filePath) ?? '')
    )
  );

  // Auth hints
  const loginRoutes = routes.filter((route) => /(^|\/)(login|signin|sign-in)(\/|$)/i.test(route));
  const callbackRoutes = routes.filter((route) => /(^|\/)(callback|oauth|sso)(\/|$)/i.test(route));

  // Expected HTTP noise from route files with 401/403
  const expectedHttpNoise: ExpectedHttpNoise[] = [];
  for (const filePath of routeFiles) {
    const content = readTextFileWithinLimit(filePath) ?? '';
    const statuses = extractStatusCodes(content).filter(
      (status) => status === 401 || status === 403
    );
    if (statuses.length === 0) continue;

    const fileName = toPosix(relative(routesDir, filePath));
    const route = routeFromFileName(fileName);
    expectedHttpNoise.push({ pathPrefix: route, statuses });
  }

  // Merge noise entries with same pathPrefix
  const noiseMerged = new Map<string, ExpectedHttpNoise>();
  for (const entry of expectedHttpNoise) {
    const existing = noiseMerged.get(entry.pathPrefix);
    if (existing) {
      existing.statuses = [...new Set([...existing.statuses, ...entry.statuses])].sort(
        (a, b) => a - b
      );
    } else {
      noiseMerged.set(entry.pathPrefix, { ...entry });
    }
  }

  return {
    routes,
    routeFamilies,
    stableSelectors,
    apiEndpoints,
    authHints: {
      loginRoutes: uniqueSorted(loginRoutes),
      callbackRoutes: uniqueSorted(callbackRoutes),
    },
    expectedHttpNoise: [...noiseMerged.values()].sort((a, b) =>
      a.pathPrefix.localeCompare(b.pathPrefix)
    ),
  };
}
