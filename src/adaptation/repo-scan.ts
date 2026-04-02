import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseJsoncObject } from "../utils/jsonc.js";
import { scanDjangoRepo } from "./django.js";
import { scanExpressRepo } from "./express.js";
import { scanGenericRepo } from "./generic.js";
import { canScanNextJsRepo, scanNextJsRepo } from "./nextjs.js";
import { scanReactRouterRepo } from "./react-router.js";
import { scanTanStackRouterRepo } from "./tanstack-router.js";
import { scanVueRouterRepo } from "./vue-router.js";
import type {
  RepoFramework,
  RepoHints,
  RepoHintsOverride,
  RepoScanOptions,
} from "./types.js";

const ExpectedHttpNoiseSchema = z.object({
  method: z.string().optional(),
  pathPrefix: z.string(),
  statuses: z.array(z.number().int()),
});

const RepoHintsOverrideSchema = z.object({
  routes: z.array(z.string()).optional(),
  routeFamilies: z.array(z.string()).optional(),
  stableSelectors: z.array(z.string()).optional(),
  apiEndpoints: z.array(
    z.object({
      route: z.string(),
      methods: z.array(z.string()),
      statuses: z.array(z.number().int()),
      authRequired: z.boolean().optional(),
      validationSchemas: z.array(z.string()).optional(),
    })
  ).optional(),
  authHints: z
    .object({
      loginRoutes: z.array(z.string()).optional(),
      callbackRoutes: z.array(z.string()).optional(),
    })
    .optional(),
  expectedHttpNoise: z.array(ExpectedHttpNoiseSchema).optional(),
});

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function emptyRepoHints(): RepoHints {
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

function mergeRepoHints(base: RepoHints, override?: RepoHintsOverride): RepoHints {
  if (!override) return base;

  return {
    routes: uniqueSorted([...base.routes, ...(override.routes ?? [])]),
    routeFamilies: uniqueSorted([
      ...base.routeFamilies,
      ...(override.routeFamilies ?? []),
    ]),
    stableSelectors: uniqueSorted([
      ...base.stableSelectors,
      ...(override.stableSelectors ?? []),
    ]),
    apiEndpoints: [
      ...base.apiEndpoints,
      ...(override.apiEndpoints ?? []),
    ]
      .reduce<RepoHints["apiEndpoints"]>((acc, endpoint) => {
        const existing = acc.find((candidate) => candidate.route === endpoint.route);
        if (!existing) {
          acc.push({
            route: endpoint.route,
            methods: uniqueSorted(endpoint.methods),
            statuses: [...new Set(endpoint.statuses)].sort((left, right) => left - right),
            authRequired: endpoint.authRequired,
            validationSchemas: uniqueSorted(endpoint.validationSchemas ?? []),
          });
          return acc;
        }

        existing.methods = uniqueSorted([...existing.methods, ...endpoint.methods]);
        existing.statuses = [...new Set([...existing.statuses, ...endpoint.statuses])].sort(
          (left, right) => left - right
        );
        existing.authRequired = existing.authRequired || endpoint.authRequired;
        existing.validationSchemas = uniqueSorted([
          ...(existing.validationSchemas ?? []),
          ...(endpoint.validationSchemas ?? []),
        ]);
        return acc;
      }, [])
      .sort((left, right) => left.route.localeCompare(right.route)),
    authHints: {
      loginRoutes: uniqueSorted([
        ...base.authHints.loginRoutes,
        ...(override.authHints?.loginRoutes ?? []),
      ]),
      callbackRoutes: uniqueSorted([
        ...base.authHints.callbackRoutes,
        ...(override.authHints?.callbackRoutes ?? []),
      ]),
    },
    expectedHttpNoise: [
      ...base.expectedHttpNoise,
      ...(override.expectedHttpNoise ?? []),
    ].sort((left, right) => left.pathPrefix.localeCompare(right.pathPrefix)),
  };
}

function loadHintsOverride(root: string, hintsFile?: string): RepoHintsOverride | undefined {
  if (!hintsFile) return undefined;

  const resolvedHintsPath = resolve(root, hintsFile);
  if (!existsSync(resolvedHintsPath)) {
    throw new Error(`Repo hints file not found: ${resolvedHintsPath}`);
  }

  const raw = readFileSync(resolvedHintsPath, "utf-8");
  return RepoHintsOverrideSchema.parse(parseJsoncObject(raw));
}

function detectFramework(root: string): RepoFramework {
  // Check Next.js first via directory marker (no file walk needed)
  if (canScanNextJsRepo(root)) return "nextjs";

  // Single-pass walk for remaining framework detection
  const signatures = {
    tanstackRouter: false,
    reactRouter: false,
    vueRouter: false,
    express: false,
    django: false,
  };

  const TANSTACK_RE = /(?:from|require\()\s*["'](?:@tanstack\/react-router|@tanstack\/router)["']/;
  const REACT_ROUTER_RE = /(?:from|require\()\s*["'](?:react-router-dom|react-router|@remix-run\/router)["']/;
  const VUE_ROUTER_RE = /(?:from|require\()\s*["']vue-router["']/;
  const VUE_CREATE_ROUTER_RE = /\bcreateRouter\s*\(/;
  const EXPRESS_RE = /(?:from|require\()\s*["'](?:express|fastify|@fastify\/[^"']+)["']/;
  const DJANGO_SETTINGS_RE = /(?:INSTALLED_APPS|django)/;

  if (existsSync(join(resolve(root), "manage.py"))) {
    signatures.django = true;
  }

  try {
    const jsExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
    const ignoredDirs = new Set([
      "node_modules", ".git", "dist", "build", "out", "coverage",
      ".next", ".nuxt", ".turbo", ".cache",
      "tests", "test", "__tests__", "fixtures", "__fixtures__",
      "mocks", "__mocks__", "generated", "__generated__",
      "__pycache__", ".venv", "venv", "env", "migrations", "static", "media",
    ]);

    const queue = [resolve(root)];
    while (queue.length > 0) {
      const dir = queue.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (ignoredDirs.has(entry.name)) continue;
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        const name = entry.name;
        const dotIdx = name.lastIndexOf(".");
        const isJs = dotIdx >= 0 && jsExtensions.has(name.slice(dotIdx));
        const isPy = name.endsWith(".py");

        if (!isJs && !isPy) continue;

        // Django detection via urls.py or settings.py
        if (isPy) {
          if (name === "urls.py") {
            signatures.django = true;
          } else if (name === "settings.py") {
            const content = readFileSync(fullPath, "utf-8");
            if (DJANGO_SETTINGS_RE.test(content)) {
              signatures.django = true;
            }
          }
          continue;
        }

        // JS/TS framework detection
        const content = readFileSync(fullPath, "utf-8");
        if (!signatures.tanstackRouter && TANSTACK_RE.test(content)) {
          signatures.tanstackRouter = true;
        }
        if (!signatures.reactRouter && REACT_ROUTER_RE.test(content)) {
          signatures.reactRouter = true;
        }
        if (!signatures.vueRouter && (VUE_ROUTER_RE.test(content) || VUE_CREATE_ROUTER_RE.test(content))) {
          signatures.vueRouter = true;
        }
        if (!signatures.express && EXPRESS_RE.test(content)) {
          signatures.express = true;
        }
      }
    }
  } catch {
    // Fall through to generic
  }

  if (signatures.tanstackRouter) return "tanstack-router";
  if (signatures.reactRouter) return "react-router";
  if (signatures.vueRouter) return "vue-router";
  if (signatures.express) return "express";
  if (signatures.django) return "django";
  return "generic";
}

export function scanRepository(options: RepoScanOptions): RepoHints {
  const root = options.root;
  const framework =
    options.framework === "auto"
      ? detectFramework(root)
      : options.framework;

  let scanned: RepoHints;
  switch (framework) {
    case "nextjs":
      scanned = scanNextJsRepo(root);
      break;
    case "react-router":
      scanned = scanReactRouterRepo(root);
      break;
    case "express":
      scanned = scanExpressRepo(root);
      break;
    case "vue-router":
      scanned = scanVueRouterRepo(root);
      break;
    case "django":
      scanned = scanDjangoRepo(root);
      break;
    case "tanstack-router":
      scanned = scanTanStackRouterRepo(root);
      break;
    case "generic":
      scanned = scanGenericRepo(root);
      break;
    default:
      scanned = emptyRepoHints();
      break;
  }

  return mergeRepoHints(scanned, loadHintsOverride(root, options.hintsFile));
}
