import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AuthSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("none"),
    }),
    z.object({
      type: z.literal("stored-state"),
      stateFile: z.string(),
    }),
    z.object({
      type: z.literal("form"),
      loginUrl: z.string(),
      credentials: z.record(z.string()),
      successIndicator: z.string(),
    }),
    z.object({
      type: z.literal("oauth-redirect"),
      loginUrl: z.string(),
      credentials: z.record(z.string()),
      successIndicator: z.string(),
    }),
  ])
  .default({ type: "none" });

const WorkerModelsSchema = z
  .object({
    navigation: z.string().optional(),
    form: z.string().optional(),
    crud: z.string().optional(),
  })
  .optional();

const ModelsSchema = z
  .object({
    planner: z.string().default("anthropic/claude-sonnet-4-6"),
    worker: z.string().default("anthropic/claude-haiku-4-5"),
    workers: WorkerModelsSchema,
  })
  .default({});

const ExplorationSchema = z
  .object({
    maxAreasToExplore: z.number().int().min(0).default(10),
    stepsPerArea: z.number().int().min(1).default(40),
    totalTimeout: z.number().int().min(1).default(900),
  })
  .default({});

const OutputSchema = z
  .object({
    dir: z.string().default("./webprobe-reports"),
    format: z.enum(["markdown", "json", "both"]).default("markdown"),
    screenshots: z.boolean().default(true),
  })
  .default({});

const MissionSchema = z
  .object({
    criticalFlows: z.array(z.string()).optional(),
    destructiveActionsAllowed: z.boolean().default(false),
    excludedAreas: z.array(z.string()).optional(),
    focusModes: z
      .array(z.enum(["navigation", "form", "crud"]))
      .optional(),
  })
  .optional();

const BudgetSchema = z
  .object({
    globalTimeLimitSeconds: z.number().int().min(60).default(900),
    maxStepsPerTask: z.number().int().min(5).default(40),
    maxFrontierSize: z.number().int().min(10).default(200),
    maxStateNodes: z.number().int().min(5).default(50),
  })
  .default({});

export const ConfigSchema = z.object({
  targetUrl: z.string().url(),
  appDescription: z.string().min(1),
  auth: AuthSchema,
  models: ModelsSchema,
  mission: MissionSchema,
  budget: BudgetSchema,
  exploration: ExplorationSchema,
  output: OutputSchema,
});

export type WebProbeConfig = z.infer<typeof ConfigSchema>;

function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
      const envVal = process.env[varName];
      if (envVal === undefined) {
        throw new Error(
          `Environment variable ${varName} is not set (referenced in config as \${${varName}})`
        );
      }
      return envVal;
    });
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnvVars);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateEnvVars(v),
      ])
    );
  }
  return value;
}

export function loadConfig(configPath?: string): WebProbeConfig {
  const resolvedPath = resolve(configPath ?? "webprobe.config.json");
  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  // Strip JSON comments (// and /* */)
  const stripped = raw
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Invalid JSON in config file: ${resolvedPath}`);
  }

  const interpolated = interpolateEnvVars(parsed);
  return ConfigSchema.parse(interpolated);
}

export function resolveWorkerModel(
  config: WebProbeConfig,
  workerType: string
): string {
  const perType = config.models.workers;
  if (perType) {
    const specific = (perType as Record<string, string | undefined>)[
      workerType
    ];
    if (specific) return specific;
  }
  return config.models.worker;
}
