import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from "./types.js";

const PAGE_FILE_RE = /(?:^|\/)app(?:\/.*)?\/page\.(?:ts|tsx|js|jsx|mdx)$/;
const ROUTE_FILE_RE = /(?:^|\/)app(?:\/.*)?\/route\.(?:ts|tsx|js|jsx)$/;
const SELECTOR_SOURCE_RE = /^(app|components|tests)\//;
const QUERY_ROUTE_RE = /["'`](\/[^"'`\n]*\?[^"'`\n]+)["'`]/g;
const SELECTOR_RE = /\b(id|data-testid)\s*=\s*["'`]([^"'`]+)["'`]/g;
const STATUS_RE = /status\s*:\s*(\d{3})\b/g;
const EXPORTED_METHOD_RE =
  /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b|\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
const AUTH_RE =
  /\b(getServerSession|requireAuth|requireUser|assertRole|unauthorized|forbidden|auth)\b/;
const VALIDATION_SCHEMA_RE = /\b([A-Z][A-Za-z0-9]+Schema)\b/g;

function toPosix(value: string): string {
  return value.split(sep).join("/");
}

function walkFiles(root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") {
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
  const normalized = routePath.replace(/\/+$/g, "");
  return normalized || "/";
}

function routeFamilyFromRoute(routePath: string): string {
  const [pathname] = routePath.split("?");
  if (!pathname || pathname === "/") {
    return "/";
  }

  const segments = pathname.split("/").filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : "/";
}

function stripNextRouteGroups(segments: string[]): string[] {
  return segments.filter(
    (segment) =>
      segment &&
      !(segment.startsWith("(") && segment.endsWith(")")) &&
      !segment.startsWith("@")
  );
}

function routeFromPageFile(root: string, filePath: string): string {
  const rel = toPosix(relative(root, filePath));
  const withoutPrefix = rel.replace(/^app\//, "");
  const withoutFile = withoutPrefix.replace(
    /(?:^|\/)page\.(?:ts|tsx|js|jsx|mdx)$/,
    ""
  );
  const segments = stripNextRouteGroups(withoutFile.split("/"));
  return normalizeRoutePath(`/${segments.join("/")}`);
}

function routeFromRouteFile(root: string, filePath: string): string {
  const rel = toPosix(relative(root, filePath));
  const withoutPrefix = rel.replace(/^app\//, "");
  const withoutFile = withoutPrefix.replace(
    /(?:^|\/)route\.(?:ts|tsx|js|jsx)$/,
    ""
  );
  const segments = stripNextRouteGroups(withoutFile.split("/"));
  return normalizeRoutePath(`/${segments.join("/")}`);
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
    if (attr === "id") {
      selectors.push(`#${value}`);
    } else {
      selectors.push(`[data-testid="${value}"]`);
    }
  }

  return selectors;
}

function extractExpectedHttpNoise(
  root: string,
  routeFiles: string[]
): ExpectedHttpNoise[] {
  const noise: ExpectedHttpNoise[] = [];

  for (const filePath of routeFiles) {
    const content = readFileSync(filePath, "utf-8");
    const statuses = uniqueSorted(
      [...content.matchAll(STATUS_RE)].map((match) => match[1])
    )
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
      const content = readFileSync(filePath, "utf-8");
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
    .filter(({ relPath }) => PAGE_FILE_RE.test(relPath))
    .map(({ filePath }) => filePath);
  const routeFiles = relFiles
    .filter(({ relPath }) => ROUTE_FILE_RE.test(relPath))
    .map(({ filePath }) => filePath);
  const selectorFiles = relFiles
    .filter(({ relPath }) => SELECTOR_SOURCE_RE.test(relPath))
    .map(({ filePath }) => filePath);

  const routes = uniqueSorted([
    ...pageFiles.map((filePath) => routeFromPageFile(resolvedRoot, filePath)),
    ...pageFiles.flatMap((filePath) =>
      extractQueryRoutes(readFileSync(filePath, "utf-8"))
    ),
    ...selectorFiles.flatMap((filePath) =>
      extractQueryRoutes(readFileSync(filePath, "utf-8"))
    ),
  ]);

  const stableSelectors = uniqueSorted(
    selectorFiles.flatMap((filePath) =>
      extractStableSelectors(readFileSync(filePath, "utf-8"))
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
      loginRoutes: routes.filter((route) =>
        /(^|\/)(login|signin|sign-in)(\/|$)/i.test(route)
      ),
      callbackRoutes: routes.filter((route) =>
        /(^|\/)(callback|oauth|sso)(\/|$)/i.test(route)
      ),
    },
    expectedHttpNoise: extractExpectedHttpNoise(resolvedRoot, routeFiles),
  };
}

export function canScanNextJsRepo(root: string): boolean {
  return existsSync(join(resolve(root), "app"));
}
