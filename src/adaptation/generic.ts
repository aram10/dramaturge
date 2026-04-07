import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RepoHints } from './types.js';

const TEXT_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.mdx',
]);
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

function isTextFile(path: string): boolean {
  return [...TEXT_FILE_EXTENSIONS].some((extension) => path.endsWith(extension));
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

    if (entry.isFile() && isTextFile(fullPath) && !shouldIgnoreEntry(basename(fullPath), false)) {
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

function collectMatches(content: string, pattern: RegExp): string[] {
  return [...content.matchAll(pattern)].map((match) => match[1] ?? '');
}

function routeFamily(route: string): string {
  const parts = route.split('?')[0]?.split('/').filter(Boolean) ?? [];
  return parts.length === 0 ? '/' : `/${parts[0]}`;
}

function createEmptyHints(): RepoHints {
  return {
    routes: [],
    routeFamilies: [],
    stableSelectors: [],
    apiEndpoints: [],
    authHints: {
      loginRoutes: [],
      callbackRoutes: [],
    },
    expectedHttpNoise: [],
  };
}

export function scanGenericRepo(root: string): RepoHints {
  const hints = createEmptyHints();
  const apiEndpoints = new Map<
    string,
    { route: string; methods: string[]; statuses: number[]; validationSchemas: string[] }
  >();

  for (const filePath of walkFiles(root)) {
    const content = readFileSync(filePath, 'utf-8');

    const routes = collectMatches(content, /["'`](\/(?!api\/)(?!\/)[^"'`\s]*)["'`]/g).filter(
      (route) => !/\.(css|js|png|jpg|svg|ico)$/.test(route)
    );
    hints.routes.push(...routes);

    const testIds = collectMatches(content, /data-testid=["']([^"']+)["']/g);
    const getByTestIds = collectMatches(content, /getByTestId\((?:["'`])([^"'`]+)(?:["'`])\)/g);
    hints.stableSelectors.push(
      ...testIds.map((testId) => `[data-testid="${testId}"]`),
      ...getByTestIds.map((testId) => `[data-testid="${testId}"]`)
    );

    const fetchMatches = [
      ...content.matchAll(
        /fetch\(\s*["'`](\/api\/[^"'`\s]+)["'`](?:\s*,\s*\{[\s\S]*?method:\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`][\s\S]*?\})?/g
      ),
    ];
    for (const match of fetchMatches) {
      const route = match[1] ?? '';
      const method = (match[2] ?? 'GET').toUpperCase();
      const existing = apiEndpoints.get(route) ?? {
        route,
        methods: [],
        statuses: [],
        validationSchemas: [],
      };
      existing.methods = uniqueSorted([...existing.methods, method]);
      apiEndpoints.set(route, existing);
    }

    for (const route of routes) {
      if (/\/(login|signin)\b/i.test(route)) {
        hints.authHints.loginRoutes.push(route);
      }
      if (/\/(auth|oauth)\/callback\b/i.test(route)) {
        hints.authHints.callbackRoutes.push(route);
      }
    }
  }

  hints.routes = uniqueSorted(hints.routes);
  hints.routeFamilies = uniqueSorted(hints.routes.map((route) => routeFamily(route)));
  hints.stableSelectors = uniqueSorted(hints.stableSelectors);
  hints.apiEndpoints = [...apiEndpoints.values()]
    .map((endpoint) => ({
      ...endpoint,
      methods: uniqueSorted(endpoint.methods),
      statuses: uniqueNumbers(endpoint.statuses),
      validationSchemas: uniqueSorted(endpoint.validationSchemas),
    }))
    .sort((left, right) => left.route.localeCompare(right.route));
  hints.authHints.loginRoutes = uniqueSorted(hints.authHints.loginRoutes);
  hints.authHints.callbackRoutes = uniqueSorted(hints.authHints.callbackRoutes);

  return hints;
}
