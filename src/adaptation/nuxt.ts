import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from './types.js';

const VUE_FILE_RE = /\.vue$/;
const JS_TS_FILE_RE = /\.(?:ts|js|mjs|cjs)$/;
const SELECTOR_RE = /\b(id|data-testid)\s*=\s*["'`]([^"'`]+)["'`]/g;
const STATUS_CODE_RE = /\bsetResponseStatus\s*\([^,]+,\s*(\d{3})\s*\)/g;
const CREATE_ERROR_STATUS_RE = /\bcreateError\s*\(\s*\{[^}]*statusCode\s*:\s*(\d{3})/g;
const AUTH_RE = /\b(requireAuth|getServerSession|requireUser|assertRole|unauthorized|forbidden)\b/;
const VALIDATION_SCHEMA_RE = /\b([A-Z][A-Za-z0-9]+Schema)\b/g;

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.nuxt',
  '.output',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

const METHOD_SUFFIX_RE = /\.(get|post|put|patch|delete|options|head)\.[tj]s$/;

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

function convertParam(segment: string): string {
  if (segment.startsWith('[...') && segment.endsWith(']')) {
    return `*${segment.slice(4, -1)}`;
  }
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

function pageRouteFromFile(pagesDir: string, filePath: string): string {
  const rel = toPosix(relative(pagesDir, filePath));
  // Strip .vue extension
  const withoutExt = rel.replace(/\.vue$/, '');
  const segments = withoutExt.split('/').map(convertParam);
  // Strip trailing "index"
  if (segments.length > 0 && segments[segments.length - 1] === 'index') {
    segments.pop();
  }
  return normalizeRoute(`/${segments.join('/')}`);
}

function apiRouteFromFile(apiDir: string, filePath: string): string {
  const rel = toPosix(relative(apiDir, filePath));
  // Strip extension and method suffix
  let withoutExt = rel.replace(/\.[tj]s$/, '');
  withoutExt = withoutExt.replace(/\.(get|post|put|patch|delete|options|head)$/, '');
  const segments = withoutExt.split('/').map(convertParam);
  // Strip trailing "index"
  if (segments.length > 0 && segments[segments.length - 1] === 'index') {
    segments.pop();
  }
  return normalizeRoute(`/api/${segments.join('/')}`);
}

function extractMethodFromFilename(filePath: string): string | undefined {
  const match = filePath.match(METHOD_SUFFIX_RE);
  return match ? match[1].toUpperCase() : undefined;
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
    ...[...content.matchAll(STATUS_CODE_RE)].map((m) => m[1]),
    ...[...content.matchAll(CREATE_ERROR_STATUS_RE)].map((m) => m[1]),
  ];
  return [...new Set(raw)].map((s) => Number.parseInt(s, 10)).sort((a, b) => a - b);
}

export function canScanNuxtRepo(root: string): boolean {
  const resolvedRoot = resolve(root);
  return (
    existsSync(join(resolvedRoot, 'nuxt.config.ts')) ||
    existsSync(join(resolvedRoot, 'nuxt.config.js'))
  );
}

export function scanNuxtRepo(root: string): RepoHints {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);

  const pagesDir = join(resolvedRoot, 'pages');
  const apiDir = join(resolvedRoot, 'server', 'api');
  const _componentsDir = join(resolvedRoot, 'components');

  // Categorize files
  const pageFiles: string[] = [];
  const apiFiles: string[] = [];
  const vueFiles: string[] = []; // all vue files for selector extraction

  for (const filePath of allFiles) {
    const rel = toPosix(relative(resolvedRoot, filePath));

    if (rel.startsWith('pages/') && VUE_FILE_RE.test(filePath)) {
      pageFiles.push(filePath);
      vueFiles.push(filePath);
    } else if (rel.startsWith('server/api/') && JS_TS_FILE_RE.test(filePath)) {
      apiFiles.push(filePath);
    } else if (rel.startsWith('components/') && VUE_FILE_RE.test(filePath)) {
      vueFiles.push(filePath);
    }
  }

  // Extract page routes
  const pageRoutes = pageFiles.map((f) => pageRouteFromFile(pagesDir, f));

  // Build API endpoint map (group by route)
  const apiEndpointMap = new Map<
    string,
    { methods: string[]; statuses: number[]; authRequired: boolean; validationSchemas: string[] }
  >();

  for (const filePath of apiFiles) {
    const route = apiRouteFromFile(apiDir, filePath);
    const content = readFileSync(filePath, 'utf-8');
    const methodFromName = extractMethodFromFilename(filePath);
    const methods = methodFromName ? [methodFromName] : ['GET'];
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

  // Extract selectors from all vue files
  const stableSelectors = uniqueSorted(
    vueFiles.flatMap((filePath) => extractStableSelectors(readFileSync(filePath, 'utf-8')))
  );

  // Auth hints
  const loginRoutes = routes.filter((route) => /(^|\/)(login|signin|sign-in)(\/|$)/i.test(route));
  const callbackRoutes = routes.filter((route) => /(^|\/)(callback|oauth|sso)(\/|$)/i.test(route));

  // Expected HTTP noise from API files with 401/403
  const expectedHttpNoise: ExpectedHttpNoise[] = [];
  for (const filePath of apiFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const statuses = extractStatusCodes(content).filter(
      (status) => status === 401 || status === 403
    );
    if (statuses.length === 0) continue;

    const route = apiRouteFromFile(apiDir, filePath);
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
