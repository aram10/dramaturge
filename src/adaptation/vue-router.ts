import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ApiEndpointHint, RepoHints } from './types.js';
import { readTextFileWithinLimit } from './file-utils.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);
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

const VUE_ROUTER_IMPORT_RE = /(?:from|require\()\s*["']vue-router["']/;
const CREATE_ROUTER_RE = /\bcreateRouter\s*\(/;

// Route extraction patterns
const ROUTE_CONFIG_PATH_RE = /\bpath\s*:\s*["'`](\/[^"'`]*)["'`]/g;
const ROUTER_LINK_TO_RE = /<router-link\s[^>]*?to\s*=\s*["'`](\/[^"'`]*)["'`]/g;
const ROUTER_PUSH_RE = /router\.push\(\s*["'`](\/[^"'`]*)["'`]/g;
const ROUTER_REPLACE_RE = /router\.replace\(\s*["'`](\/[^"'`]*)["'`]/g;

// Selector patterns
const SELECTOR_RE = /data-testid=["']([^"']+)["']/g;
const ID_SELECTOR_RE = /\bid\s*=\s*["'`]([^"'`]+)["'`]/g;

// API / fetch patterns
const FETCH_RE =
  /fetch\(\s*["'`](\/api\/[^"'`\s]+)["'`](?:\s*,\s*\{[\s\S]*?method:\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`][\s\S]*?\})?/g;
const AXIOS_RE = /axios\.(get|post|put|patch|delete)\(\s*["'`](\/api\/[^"'`\s]+)["'`]/g;

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

function extractRouterLinkPaths(content: string): string[] {
  return [...content.matchAll(ROUTER_LINK_TO_RE)].map((m) => normalizeRoute(m[1]));
}

function extractRouterPushPaths(content: string): string[] {
  return [...content.matchAll(ROUTER_PUSH_RE)].map((m) => normalizeRoute(m[1]));
}

function extractRouterReplacePaths(content: string): string[] {
  return [...content.matchAll(ROUTER_REPLACE_RE)].map((m) => normalizeRoute(m[1]));
}

function extractSelectors(content: string): string[] {
  const selectors: string[] = [];

  for (const match of content.matchAll(SELECTOR_RE)) {
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

function extractAxiosEndpoints(
  content: string,
  endpoints: Map<
    string,
    { route: string; methods: string[]; statuses: number[]; validationSchemas: string[] }
  >
): void {
  for (const match of content.matchAll(AXIOS_RE)) {
    const method = (match[1] ?? 'GET').toUpperCase();
    const route = match[2] ?? '';
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

function allRoutesFromContent(content: string): string[] {
  return [
    ...extractRouteConfigPaths(content),
    ...extractRouterLinkPaths(content),
    ...extractRouterPushPaths(content),
    ...extractRouterReplacePaths(content),
  ];
}

export function canScanVueRouterRepo(root: string): boolean {
  for (const filePath of walkFiles(root)) {
    if (!isSourceFile(filePath)) continue;

    const content = readTextFileWithinLimit(filePath) ?? '';
    if (VUE_ROUTER_IMPORT_RE.test(content) || CREATE_ROUTER_RE.test(content)) {
      return true;
    }
  }
  return false;
}

export function scanVueRouterRepo(root: string): RepoHints {
  const routes: string[] = [];
  const selectors: string[] = [];
  const apiEndpoints = new Map<
    string,
    { route: string; methods: string[]; statuses: number[]; validationSchemas: string[] }
  >();
  const loginRoutes: string[] = [];
  const callbackRoutes: string[] = [];

  for (const filePath of walkFiles(root)) {
    const content = readTextFileWithinLimit(filePath) ?? '';

    // Extract routes from config objects (path: "/...")
    routes.push(...extractRouteConfigPaths(content));

    // Extract routes from <router-link to="/..."> in .vue files
    routes.push(...extractRouterLinkPaths(content));

    // Extract routes from router.push("/...") calls
    routes.push(...extractRouterPushPaths(content));

    // Extract routes from router.replace("/...") calls
    routes.push(...extractRouterReplacePaths(content));

    // Extract stable selectors
    selectors.push(...extractSelectors(content));

    // Extract API fetch endpoints
    extractFetchEndpoints(content, apiEndpoints);

    // Extract API axios endpoints
    extractAxiosEndpoints(content, apiEndpoints);

    // Detect auth-related routes
    for (const route of allRoutesFromContent(content)) {
      if (/(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)) {
        loginRoutes.push(route);
      }
      if (/(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)) {
        callbackRoutes.push(route);
      }
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
