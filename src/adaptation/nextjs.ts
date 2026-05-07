// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from './types.js';
import { readTextFileWithinLimit } from './file-utils.js';
import { isCallbackRoute, isLoginRoute, trimTrailingSlashes } from './route-utils.js';

const QUERY_ROUTE_RE = /["'`](\/[^"'`\n]*\?[^"'`\n]+)["'`]/g;
const SELECTOR_RE = /\b(id|data-testid)\s*=\s*["'`]([^"'`]+)["'`]/g;
const STATUS_RE = /status\s*:\s*(\d{3})\b/g;
const EXPORTED_METHOD_RE =
  /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
const AUTH_RE =
  /\b(getServerSession|requireAuth|requireUser|assertRole|unauthorized|forbidden|auth)\b/;
const VALIDATION_SCHEMA_RE = /\b([A-Z][A-Za-z0-9]+Schema)\b/g;
const PAGE_FILE_NAMES = new Set(['page.ts', 'page.tsx', 'page.js', 'page.jsx', 'page.mdx']);
const ROUTE_FILE_NAMES = new Set(['route.ts', 'route.tsx', 'route.js', 'route.jsx']);

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

function walkFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeRoutePath(routePath: string): string {
  const normalized = trimTrailingSlashes(routePath);
  return normalized || '/';
}

function isNextAppFile(relPath: string, fileNames: Set<string>): boolean {
  if (!relPath.startsWith('app/')) {
    return false;
  }

  const segments = relPath.split('/');
  const fileName = segments[segments.length - 1];
  return fileName ? fileNames.has(fileName) : false;
}

function isSelectorSourceFile(relPath: string): boolean {
  return (
    relPath.startsWith('app/') || relPath.startsWith('components/') || relPath.startsWith('tests/')
  );
}

function routeFamilyFromRoute(routePath: string): string {
  const [pathname] = routePath.split('?');
  if (!pathname || pathname === '/') {
    return '/';
  }

  const segments = pathname.split('/').filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : '/';
}

function stripNextRouteGroups(segments: string[]): string[] {
  return segments.filter(
    (segment) =>
      segment && !(segment.startsWith('(') && segment.endsWith(')')) && !segment.startsWith('@')
  );
}

function routeFromPageFile(root: string, filePath: string): string {
  const rel = toPosix(relative(root, filePath));
  const withoutPrefix = rel.replace(/^app\//, '');
  const withoutFile = withoutPrefix.replace(/(?:^|\/)page\.(?:ts|tsx|js|jsx|mdx)$/, '');
  const segments = stripNextRouteGroups(withoutFile.split('/'));
  return normalizeRoutePath(`/${segments.join('/')}`);
}

function routeFromRouteFile(root: string, filePath: string): string {
  const rel = toPosix(relative(root, filePath));
  const withoutPrefix = rel.replace(/^app\//, '');
  const withoutFile = withoutPrefix.replace(/(?:^|\/)route\.(?:ts|tsx|js|jsx)$/, '');
  const segments = stripNextRouteGroups(withoutFile.split('/'));
  return normalizeRoutePath(`/${segments.join('/')}`);
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

function extractExpectedHttpNoise(root: string, routeFiles: string[]): ExpectedHttpNoise[] {
  const noise: ExpectedHttpNoise[] = [];

  for (const filePath of routeFiles) {
    const content = readTextFileWithinLimit(filePath) ?? '';
    const statuses = uniqueSorted([...content.matchAll(STATUS_RE)].map((match) => match[1]))
      .map((status) => Number.parseInt(status, 10))
      .filter((status) => status === 401 || status === 403);

    if (statuses.length === 0) continue;

    noise.push({
      pathPrefix: routeFromRouteFile(root, filePath),
      statuses,
    });
  }

  return noise.sort((left, right) => left.pathPrefix.localeCompare(right.pathPrefix));
}

function extractStatusCodes(content: string): number[] {
  return uniqueSorted([...content.matchAll(STATUS_RE)].map((match) => match[1])).map((status) =>
    Number.parseInt(status, 10)
  );
}

function extractRouteMethods(content: string): string[] {
  const methods: string[] = [];

  for (const match of content.matchAll(EXPORTED_METHOD_RE)) {
    methods.push(match[1] ?? match[2]);
  }

  return uniqueSorted(methods);
}

function extractApiEndpoints(root: string, routeFiles: string[]): ApiEndpointHint[] {
  return routeFiles
    .map((filePath) => {
      const content = readTextFileWithinLimit(filePath) ?? '';
      return {
        route: routeFromRouteFile(root, filePath),
        methods: extractRouteMethods(content),
        statuses: extractStatusCodes(content),
        authRequired: AUTH_RE.test(content) || /(401|403)\b/.test(content),
        validationSchemas: uniqueSorted(
          [...content.matchAll(VALIDATION_SCHEMA_RE)].map((match) => match[1])
        ),
      };
    })
    .sort((left, right) => left.route.localeCompare(right.route));
}

export function scanNextJsRepo(root: string): RepoHints {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);
  const relFiles = allFiles.map((filePath) => ({
    filePath,
    relPath: toPosix(relative(resolvedRoot, filePath)),
  }));

  const pageFiles = relFiles
    .filter(({ relPath }) => isNextAppFile(relPath, PAGE_FILE_NAMES))
    .map(({ filePath }) => filePath);
  const routeFiles = relFiles
    .filter(({ relPath }) => isNextAppFile(relPath, ROUTE_FILE_NAMES))
    .map(({ filePath }) => filePath);
  const selectorFiles = relFiles
    .filter(({ relPath }) => isSelectorSourceFile(relPath))
    .map(({ filePath }) => filePath);

  const routes = uniqueSorted([
    ...pageFiles.map((filePath) => routeFromPageFile(resolvedRoot, filePath)),
    ...pageFiles.flatMap((filePath) => extractQueryRoutes(readTextFileWithinLimit(filePath) ?? '')),
    ...selectorFiles.flatMap((filePath) =>
      extractQueryRoutes(readTextFileWithinLimit(filePath) ?? '')
    ),
  ]);

  const stableSelectors = uniqueSorted(
    selectorFiles.flatMap((filePath) =>
      extractStableSelectors(readTextFileWithinLimit(filePath) ?? '')
    )
  );
  const routeFamilies = uniqueSorted(routes.map(routeFamilyFromRoute));
  const apiEndpoints = extractApiEndpoints(resolvedRoot, routeFiles);

  return {
    routes,
    routeFamilies,
    stableSelectors,
    apiEndpoints,
    authHints: {
      loginRoutes: routes.filter(isLoginRoute),
      callbackRoutes: routes.filter(isCallbackRoute),
    },
    expectedHttpNoise: extractExpectedHttpNoise(resolvedRoot, routeFiles),
  };
}

export function canScanNextJsRepo(root: string): boolean {
  return existsSync(join(resolve(root), 'app'));
}
