import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type { ApiEndpointHint, RepoHints } from './types.js';

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

const TANSTACK_ROUTER_IMPORT_RE =
  /(?:from|require\()\s*["'](?:@tanstack\/react-router|@tanstack\/router)["']/;

// Route extraction patterns
const ROUTE_CONFIG_PATH_RE = /\bpath\s*:\s*["'`](\/[^"'`]*)["'`]/g;
const CREATE_FILE_ROUTE_PATH_RE = /\bcreateFileRoute\s*\(\s*["'`](\/[^"'`]*)["'`]\s*\)/g;

// Selector patterns
const SELECTOR_RE = /data-testid=["']([^"']+)["']/g;
const ID_SELECTOR_RE = /\bid\s*=\s*["'`]([^"'`]+)["'`]/g;
const GET_BY_TESTID_RE = /getByTestId\(["'`]([^"'`]+)["'`]\)/g;

// API / fetch patterns
const FETCH_RE =
  /fetch\(\s*["'`](\/api\/[^"'`\s]+)["'`](?:\s*,\s*\{[\s\S]*?method:\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`][\s\S]*?\})?/g;

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

function extractRouteConfigPaths(content: string): string[] {
  return [...content.matchAll(ROUTE_CONFIG_PATH_RE)].map((m) => normalizeRoute(m[1]));
}

function extractCreateFileRoutePaths(content: string): string[] {
  return [...content.matchAll(CREATE_FILE_ROUTE_PATH_RE)].map((m) => normalizeRoute(m[1]));
}

/**
 * Convert a file-based route path to its URL equivalent.
 * e.g. `__root.tsx` -> `/`, `dashboard.lazy.tsx` -> `/dashboard`,
 *      `_layout/users.tsx` -> `/users`, `users/$userId.tsx` -> `/users/:userId`
 */
function filePathToRoute(relPath: string): string {
  // Strip source extension
  let route = relPath.replace(/\.[^.]+$/, '');

  // Strip `.lazy` and `.index` suffixes
  route = route.replace(/\.lazy$/, '').replace(/\.index$/, '');

  // __root is the root route
  if (route === '__root') {
    return '/';
  }

  // index file at the root of routes dir
  if (route === 'index') {
    return '/';
  }

  const segments = route.split(sep);
  const result: string[] = [];

  for (const segment of segments) {
    // Handle index segments
    if (segment === 'index') {
      continue;
    }

    // Strip layout group prefixes (segments starting with _)
    if (segment.startsWith('_')) {
      continue;
    }

    // Convert $paramName to :paramName
    if (segment.startsWith('$')) {
      result.push(`:${segment.slice(1)}`);
      continue;
    }

    result.push(segment);
  }

  return result.length === 0 ? '/' : `/${result.join('/')}`;
}

function findRoutesDirectories(root: string): string[] {
  const candidates = [join(root, 'src', 'routes'), join(root, 'app', 'routes')];
  const found: string[] = [];

  for (const dir of candidates) {
    try {
      readdirSync(dir, { withFileTypes: true });
      found.push(dir);
    } catch {
      // directory doesn't exist
    }
  }

  return found;
}

function extractFileBasedRoutes(root: string): string[] {
  const routes: string[] = [];

  for (const routesDir of findRoutesDirectories(root)) {
    for (const filePath of walkFiles(routesDir)) {
      if (!isSourceFile(filePath)) continue;

      const relPath = relative(routesDir, filePath);
      routes.push(filePathToRoute(relPath));
    }
  }

  return routes;
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

function extractFetchEndpoints(
  content: string,
  endpoints: Map<
    string,
    { route: string; methods: string[]; statuses: number[]; validationSchemas: string[] }
  >
): void {
  for (const match of content.matchAll(FETCH_RE)) {
    const route = match[1] ?? '';
    const method = (match[2] ?? 'GET').toUpperCase();
    const existing = endpoints.get(route) ?? {
      route,
      methods: [],
      statuses: [],
      validationSchemas: [],
    };
    existing.methods = uniqueSorted([...existing.methods, method]);
    endpoints.set(route, existing);
  }
}

export function canScanTanStackRouterRepo(root: string): boolean {
  for (const filePath of walkFiles(root)) {
    if (!isSourceFile(filePath)) continue;

    const content = readFileSync(filePath, 'utf-8');
    if (TANSTACK_ROUTER_IMPORT_RE.test(content)) {
      return true;
    }
  }
  return false;
}

export function scanTanStackRouterRepo(root: string): RepoHints {
  const routes: string[] = [];
  const selectors: string[] = [];
  const apiEndpoints = new Map<
    string,
    { route: string; methods: string[]; statuses: number[]; validationSchemas: string[] }
  >();
  const loginRoutes: string[] = [];
  const callbackRoutes: string[] = [];

  for (const filePath of walkFiles(root)) {
    const content = readFileSync(filePath, 'utf-8');

    // Extract routes from route config objects (path: "/...")
    routes.push(...extractRouteConfigPaths(content));

    // Extract routes from createFileRoute("/path") calls
    routes.push(...extractCreateFileRoutePaths(content));

    // Extract stable selectors
    selectors.push(...extractSelectors(content));

    // Extract API fetch endpoints
    extractFetchEndpoints(content, apiEndpoints);

    // Detect auth-related routes
    for (const route of [
      ...extractRouteConfigPaths(content),
      ...extractCreateFileRoutePaths(content),
    ]) {
      if (/(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)) {
        loginRoutes.push(route);
      }
      if (/(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)) {
        callbackRoutes.push(route);
      }
    }
  }

  // Extract file-based routes
  const fileRoutes = extractFileBasedRoutes(root);
  routes.push(...fileRoutes);

  for (const route of fileRoutes) {
    if (/(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)) {
      loginRoutes.push(route);
    }
    if (/(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)) {
      callbackRoutes.push(route);
    }
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

  return {
    routes: sortedRoutes,
    routeFamilies: sortedFamilies,
    stableSelectors: sortedSelectors,
    apiEndpoints: sortedEndpoints,
    authHints: {
      loginRoutes: uniqueSorted(loginRoutes),
      callbackRoutes: uniqueSorted(callbackRoutes),
    },
    expectedHttpNoise: [],
  };
}
