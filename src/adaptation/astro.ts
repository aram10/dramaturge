import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from "./types.js";

const ASTRO_PAGE_RE = /\.(?:astro|md|mdx)$/;
const JS_TS_FILE_RE = /\.(?:ts|js|mjs|cjs)$/;
const ASTRO_FILE_RE = /\.astro$/;
const SELECTOR_RE = /\b(id|data-testid)\s*=\s*["'`]([^"'`]+)["'`]/g;
const STATUS_RE = /status\s*:\s*(\d{3})\b/g;
const EXPORTED_METHOD_RE =
  /\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
const AUTH_RE =
  /\b(locals\.user|getSession|requireAuth|requireUser|assertRole|unauthorized|forbidden)\b/;
const VALIDATION_SCHEMA_RE = /\b([A-Z][A-Za-z0-9]+Schema)\b/g;

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".astro", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".turbo", ".cache",
]);

function toPosix(value: string): string {
  return value.split(sep).join("/");
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
  const normalized = routePath.replace(/\/+$/g, "");
  return normalized || "/";
}

function routeFamily(routePath: string): string {
  const [pathname] = routePath.split("?");
  if (!pathname || pathname === "/") return "/";
  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : "/";
}

function convertParam(segment: string): string {
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `*${segment.slice(4, -1)}`;
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

function routeFromFile(pagesDir: string, filePath: string): string {
  const rel = toPosix(relative(pagesDir, filePath));
  const withoutExt = rel.replace(/\.(?:astro|md|mdx|ts|js|mjs|cjs)$/, "");
  const segments = withoutExt.split("/").map(convertParam);
  if (segments.length > 0 && segments[segments.length - 1] === "index") {
    segments.pop();
  }
  return normalizeRoute(`/${segments.join("/")}`);
}

function extractStableSelectors(content: string): string[] {
  const selectors: string[] = [];
  for (const match of content.matchAll(SELECTOR_RE)) {
    const [, attr, value] = match;
    if (attr === "id") {
      selectors.push(`#${value}`);
    } else {
      selectors.push(`[data-testid="${value}"]`);
    }
  }
  return selectors;
}

function extractStatusCodes(content: string): number[] {
  const raw = [...content.matchAll(STATUS_RE)].map((m) => m[1]);
  return [...new Set(raw)].map((s) => Number.parseInt(s, 10)).sort((a, b) => a - b);
}

function extractRouteMethods(content: string): string[] {
  const methods: string[] = [];
  for (const match of content.matchAll(EXPORTED_METHOD_RE)) {
    methods.push(match[1]);
  }
  return uniqueSorted(methods);
}

export function canScanAstroRepo(root: string): boolean {
  const resolvedRoot = resolve(root);
  return (
    existsSync(join(resolvedRoot, "astro.config.mjs")) ||
    existsSync(join(resolvedRoot, "astro.config.ts")) ||
    existsSync(join(resolvedRoot, "astro.config.js"))
  );
}

export function scanAstroRepo(root: string): RepoHints {
  const resolvedRoot = resolve(root);
  const allFiles = walkFiles(resolvedRoot);

  const pagesDir = join(resolvedRoot, "src", "pages");

  const pageFiles: string[] = [];
  const apiFiles: string[] = [];
  const astroFiles: string[] = [];

  for (const filePath of allFiles) {
    const rel = toPosix(relative(resolvedRoot, filePath));

    if (rel.startsWith("src/pages/")) {
      if (ASTRO_PAGE_RE.test(filePath)) {
        pageFiles.push(filePath);
        if (ASTRO_FILE_RE.test(filePath)) {
          astroFiles.push(filePath);
        }
      } else if (JS_TS_FILE_RE.test(filePath)) {
        apiFiles.push(filePath);
      }
    } else if (rel.startsWith("src/components/") && ASTRO_FILE_RE.test(filePath)) {
      astroFiles.push(filePath);
    }
  }

  // Extract page routes
  const pageRoutes = pageFiles.map((f) => routeFromFile(pagesDir, f));

  // Build API endpoint map (group by route)
  const apiEndpointMap = new Map<
    string,
    { methods: string[]; statuses: number[]; authRequired: boolean; validationSchemas: string[] }
  >();

  for (const filePath of apiFiles) {
    const route = routeFromFile(pagesDir, filePath);
    const content = readFileSync(filePath, "utf-8");
    const methods = extractRouteMethods(content);
    const statuses = extractStatusCodes(content);
    const authRequired = AUTH_RE.test(content);
    const validationSchemas = uniqueSorted(
      [...content.matchAll(VALIDATION_SCHEMA_RE)].map((m) => m[1]),
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

  const routes = uniqueSorted([...pageRoutes, ...apiRoutes]);
  const routeFamilies = uniqueSorted(routes.map(routeFamily));

  // Extract selectors from all .astro files (pages + components)
  const stableSelectors = uniqueSorted(
    astroFiles.flatMap((filePath) =>
      extractStableSelectors(readFileSync(filePath, "utf-8")),
    ),
  );

  // Auth hints
  const loginRoutes = routes.filter((route) =>
    /(^|\/)(login|signin|sign-in)(\/|$)/i.test(route),
  );
  const callbackRoutes = routes.filter((route) =>
    /(^|\/)(callback|oauth|sso)(\/|$)/i.test(route),
  );

  // Expected HTTP noise from API files with 401/403
  const expectedHttpNoise: ExpectedHttpNoise[] = [];
  for (const filePath of apiFiles) {
    const content = readFileSync(filePath, "utf-8");
    const statuses = extractStatusCodes(content).filter(
      (status) => status === 401 || status === 403,
    );
    if (statuses.length === 0) continue;

    const route = routeFromFile(pagesDir, filePath);
    expectedHttpNoise.push({ pathPrefix: route, statuses });
  }

  // Merge noise entries with same pathPrefix
  const noiseMerged = new Map<string, ExpectedHttpNoise>();
  for (const entry of expectedHttpNoise) {
    const existing = noiseMerged.get(entry.pathPrefix);
    if (existing) {
      existing.statuses = [...new Set([...existing.statuses, ...entry.statuses])].sort(
        (a, b) => a - b,
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
      a.pathPrefix.localeCompare(b.pathPrefix),
    ),
  };
}
