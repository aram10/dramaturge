// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from './types.js';
import { readTextFileWithinLimit } from './file-utils.js';

const PAGE_FILE_RE = /(?:^|\/)src\/routes(?:\/.*)?\/\+page\.(?:svelte|ts|js)$/;
const SERVER_FILE_RE = /(?:^|\/)src\/routes(?:\/.*)?\/\+server\.(?:ts|js)$/;
const SVELTE_FILE_RE = /\.svelte$/;
const SELECTOR_SOURCE_RE = /^src\/(routes|lib)\//;
const QUERY_ROUTE_RE = /["'`](\/[^"'`\n]*\?[^"'`\n]+)["'`]/g;
const SELECTOR_RE = /\b(id|data-testid)\s*=\s*["'`]([^"'`]+)["'`]/g;
const STATUS_RE = /status\s*:\s*(\d{3})\b/g;
const SVELTEKIT_ERROR_RE = /\berror\s*\(\s*(\d{3})\b/g;
const EXPORTED_METHOD_RE =
  /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
const AUTH_RE =
  /\b(locals\.user|getSession|requireAuth|requireUser|assertRole|unauthorized|forbidden)\b/;
const VALIDATION_SCHEMA_RE = /\b([A-Z][A-Za-z0-9]+Schema)\b/g;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
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
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

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
  if (!pathname || pathname === '/') {
    return '/';
  }

  const segments = pathname.split('/').filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : '/';
}

function stripRouteGroups(segments: string[]): string[] {
  return segments.filter(
    (segment) => segment && !(segment.startsWith('(') && segment.endsWith(')'))
  );
}

function convertParam(segment: string): string {
  if (segment.startsWith('[[') && segment.endsWith(']]')) {
    return `:${segment.slice(2, -2)}?`;
  }
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return `*${segment.slice(4, -1)}`;
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

function routeFromFile(root: string, filePath: string): string {
  const rel = toPosix(relative(root, filePath));
  const withoutPrefix = rel.replace(/^src\/routes\//, '');
  const withoutFile = withoutPrefix.replace(/\/?\+(?:page|server|layout)\.(?:svelte|ts|js)$/, '');
  const segments = stripRouteGroups(withoutFile.split('/')).map(convertParam);
  return normalizeRoute(`/${segments.join('/')}`);
}

function extractQueryRoutes(content: string): string[] {
  const routes: string[] = [];
  for (const match of content.matchAll(QUERY_ROUTE_RE)) {
    routes.push(match[1]);
  }
  return routes;
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
    ...[...content.matchAll(STATUS_RE)].map((m) => m[1]),
    ...[...content.matchAll(SVELTEKIT_ERROR_RE)].map((m) => m[1]),
  ];
  return uniqueSorted(raw).map((s) => Number.parseInt(s, 10));
}

function extractRouteMethods(content: string): string[] {
  const methods: string[] = [];

  for (const match of content.matchAll(EXPORTED_METHOD_RE)) {
    methods.push(match[1] ?? match[2]);
  }

  return uniqueSorted(methods);
}

function extractApiEndpoints(root: string, serverFiles: string[]): ApiEndpointHint[] {
  return serverFiles
    .map((filePath) => {
      const content = readTextFileWithinLimit(filePath) ?? '';
      return {
        route: routeFromFile(root, filePath),
        methods: extractRouteMethods(content),
        statuses: extractStatusCodes(content),
        authRequired: AUTH_RE.test(content) || /(401|403)\b/.test(content),
        validationSchemas: uniqueSorted(
          [...content.matchAll(VALIDATION_SCHEMA_RE)].map((m) => m[1])
        ),
      };
    })
    .sort((left, right) => left.route.localeCompare(right.route));
}

function extractExpectedHttpNoise(root: string, serverFiles: string[]): ExpectedHttpNoise[] {
  const noise: ExpectedHttpNoise[] = [];

  for (const filePath of serverFiles) {
    const content = readTextFileWithinLimit(filePath) ?? '';
    const statuses = extractStatusCodes(content).filter(
      (status) => status === 401 || status === 403
    );

    if (statuses.length === 0) continue;

    noise.push({
      pathPrefix: routeFromFile(root, filePath),
      statuses,
    });
  }

  return noise.sort((left, right) => left.pathPrefix.localeCompare(right.pathPrefix));
}

export function canScanSvelteKitRepo(root: string): boolean {
  const resolvedRoot = resolve(root);
  if (
    existsSync(join(resolvedRoot, 'svelte.config.js')) ||
    existsSync(join(resolvedRoot, 'svelte.config.ts'))
  ) {
    return true;
  }
  try {
    const pkg = readTextFileWithinLimit(join(resolvedRoot, 'package.json')) ?? '';
    return pkg.includes('@sveltejs/kit');
  } catch {
    return false;
  }
}

export function scanSvelteKitRepo(root: string): RepoHints {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);
  const relFiles = allFiles.map((filePath) => ({
    filePath,
    relPath: toPosix(relative(resolvedRoot, filePath)),
  }));

  const pageFiles = relFiles
    .filter(({ relPath }) => PAGE_FILE_RE.test(relPath))
    .map(({ filePath }) => filePath);
  const serverFiles = relFiles
    .filter(({ relPath }) => SERVER_FILE_RE.test(relPath))
    .map(({ filePath }) => filePath);
  const svelteFiles = relFiles
    .filter(({ relPath }) => SELECTOR_SOURCE_RE.test(relPath) && SVELTE_FILE_RE.test(relPath))
    .map(({ filePath }) => filePath);

  const routes = uniqueSorted([
    ...pageFiles.map((filePath) => routeFromFile(resolvedRoot, filePath)),
    ...serverFiles.map((filePath) => routeFromFile(resolvedRoot, filePath)),
    ...pageFiles.flatMap((filePath) => extractQueryRoutes(readTextFileWithinLimit(filePath) ?? '')),
    ...svelteFiles.flatMap((filePath) =>
      extractQueryRoutes(readTextFileWithinLimit(filePath) ?? '')
    ),
  ]);

  const stableSelectors = uniqueSorted(
    svelteFiles.flatMap((filePath) =>
      extractStableSelectors(readTextFileWithinLimit(filePath) ?? '')
    )
  );
  const routeFamilies = uniqueSorted(routes.map(routeFamily));
  const apiEndpoints = extractApiEndpoints(resolvedRoot, serverFiles);

  return {
    routes,
    routeFamilies,
    stableSelectors,
    apiEndpoints,
    authHints: {
      loginRoutes: routes.filter((route) => /(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)),
      callbackRoutes: routes.filter((route) => /(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)),
    },
    expectedHttpNoise: extractExpectedHttpNoise(resolvedRoot, serverFiles),
  };
}
