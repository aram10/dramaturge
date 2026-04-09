import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from './types.js';
import { readTextFileWithinLimit } from './file-utils.js';

const SOURCE_EXTENSIONS = new Set(['.py', '.html']);
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
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'migrations',
  'static',
  'media',
]);
const IGNORED_FILE_NAME_PATTERNS = [
  /\.test\./i,
  /\.spec\./i,
  /\.fixture\./i,
  /\.mock\./i,
  /\.stories\./i,
];

// Route extraction from urls.py
const DJANGO_URL_PATTERN_RE = /(?:path|re_path|url)\s*\(\s*["']([^"']*)["']/g;

// DRF api_view decorator with methods
const API_VIEW_DECORATOR_RE = /@api_view\s*\(\s*\[([^\]]*)\]\s*\)/g;

// ViewSet class definitions
const VIEWSET_CLASS_RE = /class\s+(\w+)\s*\([^)]*ViewSet[^)]*\)/g;

// @action decorator
const ACTION_DECORATOR_RE = /@action\s*\(\s*[^)]*methods\s*=\s*\[([^\]]*)\][^)]*\)/g;

// Selector patterns in templates
const SELECTOR_RE = /data-testid=["']([^"']+)["']/g;
const ID_SELECTOR_RE = /\bid\s*=\s*["']([^"']+)["']/g;

// Django settings detection
const DJANGO_SETTINGS_RE = /(?:INSTALLED_APPS|django)/;

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
  // Strip leading regex anchors (^) from re_path / url patterns
  let cleaned = raw.replace(/^\^/, '');
  // Strip trailing regex anchors ($)
  cleaned = cleaned.replace(/\$$/, '');
  // Ensure leading slash
  if (cleaned && !cleaned.startsWith('/')) {
    cleaned = `/${cleaned}`;
  }
  const trimmed = cleaned.replace(/\/+$/, '');
  return trimmed || '/';
}

function extractDjangoRoutes(content: string): string[] {
  return [...content.matchAll(DJANGO_URL_PATTERN_RE)].map((m) => normalizeRoute(m[1] ?? ''));
}

function extractApiViewMethods(content: string): string[][] {
  return [...content.matchAll(API_VIEW_DECORATOR_RE)].map((m) => {
    const raw = m[1] ?? '';
    return raw
      .split(',')
      .map((s) => s.trim().replace(/["']/g, '').toUpperCase())
      .filter(Boolean);
  });
}

function extractActionMethods(content: string): string[][] {
  return [...content.matchAll(ACTION_DECORATOR_RE)].map((m) => {
    const raw = m[1] ?? '';
    return raw
      .split(',')
      .map((s) => s.trim().replace(/["']/g, '').toUpperCase())
      .filter(Boolean);
  });
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

export function canScanDjangoRepo(root: string): boolean {
  // Check for manage.py in root
  if (existsSync(join(root, 'manage.py'))) {
    return true;
  }

  for (const filePath of walkFiles(root)) {
    const name = basename(filePath);

    // Check for urls.py anywhere
    if (name === 'urls.py') {
      return true;
    }

    // Check for settings.py containing Django markers
    if (name === 'settings.py') {
      const content = readTextFileWithinLimit(filePath) ?? '';
      if (DJANGO_SETTINGS_RE.test(content)) {
        return true;
      }
    }
  }

  return false;
}

export function scanDjangoRepo(root: string): RepoHints {
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
    const name = basename(filePath);

    // Extract routes from urls.py files
    if (name === 'urls.py') {
      const fileRoutes = extractDjangoRoutes(content);
      routes.push(...fileRoutes);

      for (const route of fileRoutes) {
        // Detect API endpoints (routes under /api/ prefix)
        if (/^\/api\//i.test(route)) {
          const existing = apiEndpoints.get(route) ?? {
            route,
            methods: [],
            statuses: [],
            authRequired: false,
            validationSchemas: [],
          };
          // Default methods for url-only detection
          if (existing.methods.length === 0) {
            existing.methods = ['GET'];
          }
          apiEndpoints.set(route, existing);
        }

        // Auth-related routes
        if (/(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)) {
          loginRoutes.push(route);
        }
        if (/(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)) {
          callbackRoutes.push(route);
        }
      }
    }

    // Extract DRF @api_view endpoints from Python files
    if (filePath.endsWith('.py')) {
      const apiViewMethodSets = extractApiViewMethods(content);
      const actionMethodSets = extractActionMethods(content);

      // Collect all methods from @api_view and @action decorators
      const allMethods: string[] = [];
      for (const methods of [...apiViewMethodSets, ...actionMethodSets]) {
        allMethods.push(...methods);
      }

      // Check for ViewSet classes
      const viewSetMatches = [...content.matchAll(VIEWSET_CLASS_RE)];
      if (viewSetMatches.length > 0) {
        // ViewSets typically support standard CRUD methods
        allMethods.push('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
      }

      // Associate methods with API routes from the same app's urls.py
      if (allMethods.length > 0 && name === 'views.py') {
        const siblingUrls = join(dirname(filePath), 'urls.py');
        if (existsSync(siblingUrls)) {
          const urlsContent = readTextFileWithinLimit(siblingUrls) ?? '';
          const fileRoutes = extractDjangoRoutes(urlsContent);
          for (const route of fileRoutes) {
            if (!/^\/api\//i.test(route)) continue;
            const existing = apiEndpoints.get(route) ?? {
              route,
              methods: [],
              statuses: [],
              authRequired: false,
              validationSchemas: [],
            };
            existing.methods = uniqueSorted([...existing.methods, ...allMethods]);
            apiEndpoints.set(route, existing);
          }
        }
      }

      // Detect auth-related patterns and scope them to API routes in the same app
      if (name === 'views.py') {
        const hasAuthMiddleware =
          /(?:login_required|permission_required|IsAuthenticated|IsAdminUser)\b/.test(content);
        if (hasAuthMiddleware) {
          const siblingUrls = join(dirname(filePath), 'urls.py');
          if (existsSync(siblingUrls)) {
            const urlsContent = readTextFileWithinLimit(siblingUrls) ?? '';
            const appRoutes = extractDjangoRoutes(urlsContent).map(normalizeRoute);
            for (const route of appRoutes) {
              if (!/^\/api\//i.test(route)) continue;
              const ep = apiEndpoints.get(route);
              if (ep) {
                ep.authRequired = true;
              }

              // Expected HTTP noise for auth-guarded API views
              const key = route;
              const existingNoise = noiseMap.get(key) ?? {
                pathPrefix: route,
                statuses: [],
              };
              existingNoise.statuses = uniqueNumbers([...existingNoise.statuses, 401, 403]);
              noiseMap.set(key, existingNoise);
            }
          }
        }
      }
    }

    // Extract stable selectors from template files
    if (filePath.endsWith('.html')) {
      selectors.push(...extractSelectors(content));
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
