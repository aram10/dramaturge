import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { ApiEndpointHint, ExpectedHttpNoise, RepoHints } from "./types.js";

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  "tmp",
  "log",
  "vendor",
  "public",
  "coverage",
  "test",
  "spec",
]);

const IGNORED_FILE_NAME_PATTERNS = [
  /\.test\./i,
  /\.spec\./i,
  /\.fixture\./i,
  /\.mock\./i,
];

const SELECTOR_RE = /data-testid=["']([^"']+)["']/g;
const ID_SELECTOR_RE = /\bid\s*=\s*["']([^"']+)["']/g;

const AUTH_MIDDLEWARE_RE =
  /before_action\s+:(authenticate_user!|require_login|require_authentication)/;

const RENDER_STATUS_SYMBOL_RE = /render\s+.*?status:\s*:(\w+)/g;
const RENDER_STATUS_NUMBER_RE = /render\s+.*?status:\s*(\d+)/g;
const HEAD_STATUS_SYMBOL_RE = /head\s+:(\w+)/g;
const HEAD_STATUS_NUMBER_RE = /head\s+(\d+)/g;

const RAILS_STATUS_SYMBOLS: Record<string, number> = {
  ok: 200,
  created: 201,
  accepted: 202,
  no_content: 204,
  moved_permanently: 301,
  found: 302,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  unprocessable_entity: 422,
  internal_server_error: 500,
};

interface ParsedRoute {
  path: string;
  methods: string[];
}

function isSourceFile(name: string): boolean {
  return name.endsWith(".rb") || name.endsWith(".erb");
}

function shouldIgnoreEntry(name: string, isDirectory: boolean): boolean {
  if (IGNORED_DIRECTORY_NAMES.has(name)) return true;
  if (isDirectory) return false;
  return IGNORED_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function walkFiles(root: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (shouldIgnoreEntry(entry.name, entry.isDirectory())) continue;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile() && isSourceFile(entry.name) && !shouldIgnoreEntry(basename(fullPath), false)) {
      results.push(fullPath);
    }
  }
  return results;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function routeFamily(route: string): string {
  const parts = route.split("?")[0]?.split("/").filter(Boolean) ?? [];
  return parts.length === 0 ? "/" : `/${parts[0]}`;
}

function normalizePath(raw: string): string {
  let cleaned = raw.replace(/\/+$/, "");
  if (cleaned && !cleaned.startsWith("/")) cleaned = `/${cleaned}`;
  return cleaned || "/";
}

function parseRoutesFile(content: string): ParsedRoute[] {
  const lines = content.split("\n");
  const routes: ParsedRoute[] = [];
  const prefixStack: string[] = [];
  let blockDepth = 0;
  const namespaceDepths: number[] = [];

  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (!trimmed) continue;

    const nsMatch = trimmed.match(/^namespace\s+:(\w+)\s+do\s*$/);
    if (nsMatch) {
      blockDepth++;
      namespaceDepths.push(blockDepth);
      prefixStack.push(nsMatch[1]);
      continue;
    }

    if (/\bdo\s*(\|[^|]*\|)?\s*$/.test(trimmed)) {
      blockDepth++;
      continue;
    }

    if (/^end$/.test(trimmed)) {
      if (
        namespaceDepths.length > 0 &&
        namespaceDepths[namespaceDepths.length - 1] === blockDepth
      ) {
        namespaceDepths.pop();
        prefixStack.pop();
      }
      blockDepth--;
      continue;
    }

    const prefix =
      prefixStack.length > 0 ? "/" + prefixStack.join("/") : "";

    // root "controller#action"
    if (/^root\s+/.test(trimmed)) {
      routes.push({ path: "/", methods: ["GET"] });
      continue;
    }

    // HTTP verb routes
    const httpMatch = trimmed.match(
      /^(get|post|put|patch|delete)\s+["']([^"']+)["']/,
    );
    if (httpMatch) {
      const method = httpMatch[1].toUpperCase();
      let path = httpMatch[2];
      if (!path.startsWith("/")) path = "/" + path;
      routes.push({ path: normalizePath(prefix + path), methods: [method] });
      continue;
    }

    // resources :name, only: [...]
    const resourcesMatch = trimmed.match(
      /^resources\s+:(\w+)(?:\s*,\s*only:\s*\[([^\]]*)\])?/,
    );
    if (resourcesMatch) {
      const name = resourcesMatch[1];
      const onlyStr = resourcesMatch[2];
      const basePath = prefix + "/" + name;

      let actions: string[];
      if (onlyStr !== undefined) {
        actions = onlyStr
          .split(",")
          .map((s) => s.trim().replace(/^:/, ""))
          .filter(Boolean);
      } else {
        actions = ["index", "create", "show", "update", "destroy", "new", "edit"];
      }

      for (const action of actions) {
        switch (action) {
          case "index":
            routes.push({ path: normalizePath(basePath), methods: ["GET"] });
            break;
          case "create":
            routes.push({ path: normalizePath(basePath), methods: ["POST"] });
            break;
          case "show":
            routes.push({ path: normalizePath(basePath + "/:id"), methods: ["GET"] });
            break;
          case "update":
            routes.push({ path: normalizePath(basePath + "/:id"), methods: ["PUT", "PATCH"] });
            break;
          case "destroy":
            routes.push({ path: normalizePath(basePath + "/:id"), methods: ["DELETE"] });
            break;
          case "new":
            routes.push({ path: normalizePath(basePath + "/new"), methods: ["GET"] });
            break;
          case "edit":
            routes.push({ path: normalizePath(basePath + "/:id/edit"), methods: ["GET"] });
            break;
        }
      }
      continue;
    }
  }

  return routes;
}

function extractStatusCodes(content: string): number[] {
  const statuses: number[] = [];
  for (const match of content.matchAll(RENDER_STATUS_SYMBOL_RE)) {
    const code = RAILS_STATUS_SYMBOLS[match[1]];
    if (code) statuses.push(code);
  }
  for (const match of content.matchAll(RENDER_STATUS_NUMBER_RE)) {
    statuses.push(parseInt(match[1], 10));
  }
  for (const match of content.matchAll(HEAD_STATUS_SYMBOL_RE)) {
    const code = RAILS_STATUS_SYMBOLS[match[1]];
    if (code) statuses.push(code);
  }
  for (const match of content.matchAll(HEAD_STATUS_NUMBER_RE)) {
    statuses.push(parseInt(match[1], 10));
  }
  return statuses;
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

export function canScanRailsRepo(root: string): boolean {
  if (existsSync(join(root, "config", "routes.rb"))) return true;
  const gemfilePath = join(root, "Gemfile");
  if (existsSync(gemfilePath)) {
    const content = readFileSync(gemfilePath, "utf-8");
    if (/gem\s+["']rails["']/.test(content)) return true;
  }
  if (existsSync(join(root, "bin", "rails"))) return true;
  return false;
}

export function scanRailsRepo(root: string): RepoHints {
  const allRoutes: string[] = [];
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
  const noiseMap = new Map<
    string,
    { method?: string; pathPrefix: string; statuses: number[] }
  >();

  // Phase 1: Parse routes from config/routes.rb
  const routesPath = join(root, "config", "routes.rb");
  if (existsSync(routesPath)) {
    const routesContent = readFileSync(routesPath, "utf-8");
    const parsedRoutes = parseRoutesFile(routesContent);

    for (const parsed of parsedRoutes) {
      const path = normalizePath(parsed.path);
      allRoutes.push(path);

      if (/^\/api\//i.test(path)) {
        const ep = apiEndpoints.get(path) ?? {
          route: path,
          methods: [],
          statuses: [],
          authRequired: false,
          validationSchemas: [],
        };
        for (const method of parsed.methods) {
          if (!ep.methods.includes(method)) ep.methods.push(method);
        }
        apiEndpoints.set(path, ep);
      }

      if (/(^|\/)(login|signin|sign-in)(\/|$)/i.test(path)) {
        loginRoutes.push(path);
      }
      if (/(^|\/)(callback|oauth|sso)(\/|$)/i.test(path)) {
        callbackRoutes.push(path);
      }
    }
  }

  // Phase 2: Walk files for controllers and templates
  const controllersDir = join(root, "app", "controllers");

  for (const filePath of walkFiles(root)) {
    const content = readFileSync(filePath, "utf-8");

    // Controller analysis
    const relToControllers = relative(controllersDir, filePath);
    if (
      filePath.endsWith(".rb") &&
      !relToControllers.startsWith("..") &&
      relToControllers !== filePath
    ) {
      const relPath = relToControllers;
      const controllerPrefix =
        "/" + relPath.replace(/_controller\.rb$/, "").replace(/\\/g, "/");

      const hasAuth = AUTH_MIDDLEWARE_RE.test(content);
      const statuses = extractStatusCodes(content);

      for (const [route, ep] of apiEndpoints) {
        if (route.startsWith(controllerPrefix)) {
          if (hasAuth) {
            ep.authRequired = true;
            const existing = noiseMap.get(route) ?? {
              pathPrefix: route,
              statuses: [],
            };
            existing.statuses = uniqueNumbers([
              ...existing.statuses,
              401,
              403,
            ]);
            noiseMap.set(route, existing);
          }
          ep.statuses = uniqueNumbers([...ep.statuses, ...statuses]);
        }
      }
    }

    // Template selector extraction
    if (filePath.endsWith(".erb")) {
      selectors.push(...extractSelectors(content));
    }
  }

  const sortedRoutes = uniqueSorted(allRoutes.map(normalizePath));
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
