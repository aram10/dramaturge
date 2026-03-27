import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { parseJsoncObject } from "../utils/jsonc.js";
import { canScanNextJsRepo, scanNextJsRepo } from "./nextjs.js";
import type {
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

export function scanRepository(options: RepoScanOptions): RepoHints {
  const root = options.root;
  const framework =
    options.framework === "auto"
      ? canScanNextJsRepo(root)
        ? "nextjs"
        : "generic"
      : options.framework;

  const scanned =
    framework === "nextjs" ? scanNextJsRepo(root) : emptyRepoHints();

  return mergeRepoHints(scanned, loadHintsOverride(root, options.hintsFile));
}
