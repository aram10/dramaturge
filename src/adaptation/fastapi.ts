import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from "./types.js";

const SOURCE_EXTENSIONS = new Set([".py", ".html"]);
const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "tests",
  "test",
  "__tests__",
  "fixtures",
  "__fixtures__",
  "mocks",
  "__mocks__",
  "generated",
  "__generated__",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "migrations",
  "static",
  "media",
]);
const IGNORED_FILE_NAME_PATTERNS = [
  /\.test\./i,
  /\.spec\./i,
  /\.fixture\./i,
  /\.mock\./i,
  /\.stories\./i,
];

// FastAPI route decorator: @app.get("/path") or @router.post("/path")
const FASTAPI_ROUTE_RE =
  /@(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/g;

// FastAPI import detection
const FASTAPI_IMPORT_RE = /(?:from\s+fastapi\s+import|import\s+fastapi)\b/;

// Status code patterns
const STATUS_CODE_KWARG_RE = /status_code\s*=\s*(\d+)/g;
const HTTP_EXCEPTION_RE = /HTTPException\s*\(\s*status_code\s*=\s*(\d+)/g;
const STATUS_CONST_RE = /status\.HTTP_(\d{3})_/g;

// Auth dependency patterns
const AUTH_DEPENDS_RE = /Depends\s*\(\s*(get_current_user|require_auth|verify_token|get_user|check_auth)\b/;

// Pydantic model detection
const PYDANTIC_MODEL_RE = /class\s+(\w+)\s*\(\s*BaseModel\s*\)/g;

// Selector patterns in templates
const SELECTOR_RE = /data-testid=["']([^"']+)["']/g;
const ID_SELECTOR_RE = /\bid\s*=\s*["']([^"']+)["']/g;

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

  if (!existsSync(root)) return results;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (shouldIgnoreEntry(entry.name, entry.isDirectory())) {
      continue;
    }

    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }

    if (
      entry.isFile() &&
      isSourceFile(fullPath) &&
      !shouldIgnoreEntry(basename(fullPath), false)
    ) {
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
  const parts = route.split("?")[0]?.split("/").filter(Boolean) ?? [];
  return parts.length === 0 ? "/" : `/${parts[0]}`;
}

function convertPathParams(route: string): string {
  // Convert FastAPI {param} to :param
  return route.replace(/\{(\w+)\}/g, ":$1");
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

function extractStatusCodes(content: string): number[] {
  const codes: number[] = [];

  for (const match of content.matchAll(STATUS_CODE_KWARG_RE)) {
    codes.push(Number(match[1]));
  }
  for (const match of content.matchAll(HTTP_EXCEPTION_RE)) {
    codes.push(Number(match[1]));
  }
  for (const match of content.matchAll(STATUS_CONST_RE)) {
    codes.push(Number(match[1]));
  }

  return codes;
}

function extractPydanticModels(content: string): string[] {
  return [...content.matchAll(PYDANTIC_MODEL_RE)].map((m) => m[1] ?? "").filter(Boolean);
}

export function canScanFastApiRepo(root: string): boolean {
  for (const filePath of walkFiles(root)) {
    if (!filePath.endsWith(".py")) continue;
    const content = readFileSync(filePath, "utf-8");
    if (FASTAPI_IMPORT_RE.test(content)) {
      return true;
    }
  }
  return false;
}

export function scanFastApiRepo(root: string): RepoHints {
  const routes: string[] = [];
  const selectors: string[] = [];
  const apiEndpoints = new Map<
    string,
    { route: string; methods: string[]; statuses: number[]; authRequired: boolean; validationSchemas: string[] }
  >();
  const loginRoutes: string[] = [];
  const callbackRoutes: string[] = [];
  const noiseMap = new Map<string, { method?: string; pathPrefix: string; statuses: number[] }>();

  for (const filePath of walkFiles(root)) {
    const content = readFileSync(filePath, "utf-8");

    // Extract routes from FastAPI decorators in .py files
    if (filePath.endsWith(".py")) {
      const fileStatusCodes = extractStatusCodes(content);
      const pydanticModels = extractPydanticModels(content);
      const hasAuthDependency = AUTH_DEPENDS_RE.test(content);

      for (const match of content.matchAll(FASTAPI_ROUTE_RE)) {
        const method = (match[1] ?? "").toUpperCase();
        const rawRoute = match[2] ?? "";
        const route = convertPathParams(rawRoute);

        routes.push(route);

        // Detect API endpoints: routes starting with /api/ or from APIRouter files
        const isApiRoute = /^\/api\//i.test(route) || /\bAPIRouter\s*\(/.test(content);
        if (isApiRoute) {
          const existing = apiEndpoints.get(route) ?? {
            route,
            methods: [],
            statuses: [],
            authRequired: false,
            validationSchemas: [],
          };
          existing.methods.push(method);
          existing.statuses.push(...fileStatusCodes);
          if (hasAuthDependency) {
            existing.authRequired = true;
          }
          existing.validationSchemas.push(...pydanticModels);
          apiEndpoints.set(route, existing);
        }

        // Check auth dependency on this specific handler
        // Look at the lines following the decorator for Depends(...)
        // 500 chars is enough to cover the function signature and first few lines
        const decoratorIdx = content.indexOf(match[0]);
        const functionBlock = content.slice(decoratorIdx, decoratorIdx + 500);
        const handlerHasAuth = AUTH_DEPENDS_RE.test(functionBlock);

        if (handlerHasAuth && isApiRoute) {
          const key = route;
          const existingNoise = noiseMap.get(key) ?? {
            pathPrefix: route,
            statuses: [],
          };
          existingNoise.statuses = uniqueNumbers([
            ...existingNoise.statuses,
            401,
            403,
          ]);
          noiseMap.set(key, existingNoise);
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

    // Extract stable selectors from template files
    if (filePath.endsWith(".html")) {
      selectors.push(...extractSelectors(content));
    }
  }

  const sortedRoutes = uniqueSorted(routes.map((r) => r || "/"));
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
