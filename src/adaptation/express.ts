// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from './types.js';
import { readTextFileWithinLimit } from './file-utils.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRECTORY_NAMES = new Set([
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
  'tests',
  'test',
  '__tests__',
  'fixtures',
  '__fixtures__',
  'mocks',
  '__mocks__',
  'generated',
  '__generated__',
]);
const IGNORED_FILE_NAME_PATTERNS = [
  /\.test\./i,
  /\.spec\./i,
  /\.fixture\./i,
  /\.mock\./i,
  /\.stories\./i,
];

const EXPRESS_IMPORT_RE = /(?:from|require\()\s*["'](?:express|fastify|@fastify\/[^"']+)["']/;

const ROUTE_HANDLER_BLOCK_RE =
  /(?:app|router|server|fastify)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`](\/[^"'`]*)["'`][^)]*(?:\([^)]*\))*[^;]*;/g;

const STATUS_CODE_RE = /\.status\(\s*(\d{3})\s*\)/g;

const AUTH_MIDDLEWARE_RE =
  /\b(?:requireAuth|isAuthenticated|passport\.authenticate|jwt|authorize)\b/;

// Selector patterns
const SELECTOR_RE = /data-testid=["']([^"']+)["']/g;
const ID_SELECTOR_RE = /\bid\s*=\s*["'`]([^"'`]+)["'`]/g;
const GET_BY_TESTID_RE = /getByTestId\(["'`]([^"'`]+)["'`]\)/g;

function isSourceFile(path: string): boolean {
  return [...SOURCE_EXTENSIONS].some((ext) => path.endsWith(ext));
}

function shouldIgnoreEntry(name: string, isDirectory: boolean): boolean {
  if (IGNORED_DIRECTORY_NAMES.has(name)) {
    return true;
  }
  if (isDirectory) {
    return false;
  }
  if (name.endsWith('.d.ts')) {
    return true;
  }
  return IGNORED_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function walkFiles(root: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (shouldIgnoreEntry(entry.name, entry.isDirectory())) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }

    if (entry.isFile() && isSourceFile(fullPath) && !shouldIgnoreEntry(basename(fullPath), false)) {
      results.push(fullPath);
    }
  }

  return results;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function routeFamily(route: string): string {
  const parts = route.split('?')[0]?.split('/').filter(Boolean) ?? [];
  return parts.length === 0 ? '/' : `/${parts[0]}`;
}

function normalizeRoute(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed || '/';
}

function extractRouteHandlers(content: string): { method: string; route: string; block: string }[] {
  return [...content.matchAll(ROUTE_HANDLER_BLOCK_RE)].map((m) => ({
    method: (m[1] ?? '').toUpperCase(),
    route: normalizeRoute(m[2] ?? ''),
    block: m[0],
  }));
}

function extractStatusCodes(content: string): number[] {
  return [...content.matchAll(STATUS_CODE_RE)].map((m) => Number.parseInt(m[1] ?? '0', 10));
}

function extractSelectors(content: string): string[] {
  const selectors: string[] = [];

  for (const match of content.matchAll(SELECTOR_RE)) {
    selectors.push(`[data-testid="${match[1]}"]`);
  }
  for (const match of content.matchAll(GET_BY_TESTID_RE)) {
    selectors.push(`[data-testid="${match[1]}"]`);
  }
  for (const match of content.matchAll(ID_SELECTOR_RE)) {
    selectors.push(`#${match[1]}`);
  }

  return selectors;
}

export function canScanExpressRepo(root: string): boolean {
  for (const filePath of walkFiles(root)) {
    if (!isSourceFile(filePath)) continue;

    const content = readTextFileWithinLimit(filePath) ?? '';
    if (EXPRESS_IMPORT_RE.test(content)) {
      return true;
    }
  }
  return false;
}

export function scanExpressRepo(root: string): RepoHints {
  const routes: string[] = [];
  const selectors: string[] = [];
  const apiEndpoints = new Map<
    string,
    {
      route: string;
      methods: string[];
      statuses: number[];
      authRequired: boolean;
      validationSchemas: string[];
    }
  >();
  const loginRoutes: string[] = [];
  const callbackRoutes: string[] = [];
  const noiseMap = new Map<string, { method?: string; pathPrefix: string; statuses: number[] }>();

  for (const filePath of walkFiles(root)) {
    const content = readTextFileWithinLimit(filePath) ?? '';

    const handlers = extractRouteHandlers(content);

    for (const { method, route, block } of handlers) {
      routes.push(route);

      const handlerStatuses = extractStatusCodes(block);
      const handlerHasAuth = AUTH_MIDDLEWARE_RE.test(block);

      const existing = apiEndpoints.get(route) ?? {
        route,
        methods: [],
        statuses: [],
        authRequired: false,
        validationSchemas: [],
      };
      existing.methods = uniqueSorted([...existing.methods, method]);
      existing.statuses = uniqueNumbers([...existing.statuses, ...handlerStatuses]);
      if (handlerHasAuth) {
        existing.authRequired = true;
      }
      apiEndpoints.set(route, existing);

      // Auth-related routes
      if (/(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)) {
        loginRoutes.push(route);
      }
      if (/(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)) {
        callbackRoutes.push(route);
      }

      // Expected HTTP noise for handlers with 401/403
      const authStatuses = handlerStatuses.filter((s) => s === 401 || s === 403);
      if (authStatuses.length > 0) {
        const key = `${method}:${route}`;
        const existingNoise = noiseMap.get(key) ?? {
          method,
          pathPrefix: route,
          statuses: [],
        };
        existingNoise.statuses = uniqueNumbers([...existingNoise.statuses, ...authStatuses]);
        noiseMap.set(key, existingNoise);
      }
    }

    // Extract stable selectors
    selectors.push(...extractSelectors(content));
  }

  const sortedRoutes = uniqueSorted(routes.map(normalizeRoute));
  const sortedFamilies = uniqueSorted(sortedRoutes.map(routeFamily));
  const sortedSelectors = uniqueSorted(selectors);
  const sortedEndpoints: ApiEndpointHint[] = [...apiEndpoints.values()]
    .map((ep) => ({
      ...ep,
      methods: uniqueSorted(ep.methods),
      statuses: uniqueNumbers(ep.statuses),
      validationSchemas: uniqueSorted(ep.validationSchemas),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
  const sortedNoise: ExpectedHttpNoise[] = [...noiseMap.values()]
    .map((n) => ({
      ...n,
      statuses: uniqueNumbers(n.statuses),
    }))
    .sort((a, b) => a.pathPrefix.localeCompare(b.pathPrefix));

  return {
    routes: sortedRoutes,
    routeFamilies: sortedFamilies,
    stableSelectors: sortedSelectors,
    apiEndpoints: sortedEndpoints,
    authHints: {
      loginRoutes: uniqueSorted(loginRoutes),
      callbackRoutes: uniqueSorted(callbackRoutes),
    },
    expectedHttpNoise: sortedNoise,
  };
}
