import { z } from "zod";
import { readFileSync } from "node:fs";
import { parseJsoncObject } from "./utils/jsonc.js";
import {
  getConfigFileContext,
  normalizeConfigPaths,
  type ConfigWithMeta,
  type LoadedConfigMeta,
} from "./config-paths.js";

const AuthSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("none"),
    }),
    z.object({
      type: z.literal("stored-state"),
      stateFile: z.string(),
      successIndicator: z.string().optional(),
    }),
    z.object({
      type: z.literal("form"),
      loginUrl: z.string(),
      fields: z.array(z.object({
        selector: z.string().min(1),
        value: z.string(),
        label: z.string().optional(),
        secret: z.boolean().default(false),
      })).min(1),
      submit: z.object({
        selector: z.string().min(1),
        label: z.string().optional(),
      }),
      successIndicator: z.string(),
    }),
    z.object({
      type: z.literal("oauth-redirect"),
      loginUrl: z.string(),
      steps: z.array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("click"),
            selector: z.string().min(1),
            label: z.string().optional(),
          }),
          z.object({
            type: z.literal("fill"),
            selector: z.string().min(1),
            value: z.string(),
            label: z.string().optional(),
            secret: z.boolean().default(false),
          }),
          z.object({
            type: z.literal("wait-for-selector"),
            selector: z.string().min(1),
          }),
        ])
      ).min(1),
      successIndicator: z.string(),
    }),
    z.object({
      type: z.literal("interactive"),
      loginUrl: z.string(),
      successIndicator: z.string(),
      stateFile: z.string().default("./.dramaturge-state/user.json"),
      /** Timeout in seconds for the human to complete login (default: 120). */
      manualTimeoutSeconds: z.number().int().min(30).default(120),
    }),
  ])
  .default({ type: "none" });

const WorkerModelsSchema = z
  .object({
    navigation: z.string().optional(),
    form: z.string().optional(),
    crud: z.string().optional(),
    adversarial: z.string().optional(),
  })
  .optional();

const AgentModeSchema = z.enum(["cua", "dom"]).default("cua");

const AgentModesSchema = z
  .object({
    navigation: z.enum(["cua", "dom"]).optional(),
    form: z.enum(["cua", "dom"]).optional(),
    crud: z.enum(["cua", "dom"]).optional(),
    adversarial: z.enum(["cua", "dom"]).optional(),
  })
  .optional();

const ModelsSchema = z
  .object({
    planner: z.string().default("anthropic/claude-sonnet-4-6"),
    worker: z.string().default("anthropic/claude-haiku-4-5"),
    workers: WorkerModelsSchema,
    agentMode: AgentModeSchema,
    agentModes: AgentModesSchema,
  })
  .default({
    planner: "anthropic/claude-sonnet-4-6",
    worker: "anthropic/claude-haiku-4-5",
    agentMode: "cua",
  });

const ExplorationSchema = z
  .object({
    maxAreasToExplore: z.number().int().min(0).default(10),
    stepsPerArea: z.number().int().min(1).default(40),
    totalTimeout: z.number().int().min(1).default(900),
  })
  .default({
    maxAreasToExplore: 10,
    stepsPerArea: 40,
    totalTimeout: 900,
  });

const OutputSchema = z
  .object({
    dir: z.string().default("./dramaturge-reports"),
    format: z.enum(["markdown", "json", "both"]).default("markdown"),
    screenshots: z.boolean().default(true),
  })
  .default({
    dir: "./dramaturge-reports",
    format: "markdown",
    screenshots: true,
  });

const MemorySchema = z
  .object({
    enabled: z.boolean().default(false),
    dir: z.string().default("./.dramaturge"),
    warmStart: z.boolean().default(true),
  })
  .default({
    enabled: false,
    dir: "./.dramaturge",
    warmStart: true,
  });

const VisualRegressionSchema = z
  .object({
    enabled: z.boolean().default(false),
    baselineDir: z.string().default("./.dramaturge/visual-baselines"),
    diffPixelRatioThreshold: z.number().min(0).max(1).default(0.01),
    includeAA: z.boolean().default(false),
    fullPage: z.boolean().default(true),
    maskSelectors: z.array(z.string()).default([]),
  })
  .default({
    enabled: false,
    baselineDir: "./.dramaturge/visual-baselines",
    diffPixelRatioThreshold: 0.01,
    includeAA: false,
    fullPage: true,
    maskSelectors: [],
  });

const ApiTestingSchema = z
  .object({
    enabled: z.boolean().default(false),
    maxEndpointsPerNode: z.number().int().min(1).default(4),
    maxProbeCasesPerEndpoint: z.number().int().min(1).default(6),
    unauthenticatedProbes: z.boolean().default(true),
    allowMutatingProbes: z.boolean().default(false),
  })
  .default({
    enabled: false,
    maxEndpointsPerNode: 4,
    maxProbeCasesPerEndpoint: 6,
    unauthenticatedProbes: true,
    allowMutatingProbes: false,
  });

const AdversarialSchema = z
  .object({
    enabled: z.boolean().default(false),
    maxSequencesPerNode: z.number().int().min(1).default(3),
    safeMode: z.boolean().default(true),
    includeAuthzProbes: z.boolean().default(false),
    includeConcurrencyProbes: z.boolean().default(false),
  })
  .default({
    enabled: false,
    maxSequencesPerNode: 3,
    safeMode: true,
    includeAuthzProbes: false,
    includeConcurrencyProbes: false,
  });

const JudgeSchema = z
  .object({
    enabled: z.boolean().default(true),
    requestTimeoutMs: z.number().int().min(100).default(15_000),
  })
  .default({
    enabled: true,
    requestTimeoutMs: 15_000,
  });

const MissionSchema = z
  .object({
    criticalFlows: z.array(z.string()).optional(),
    destructiveActionsAllowed: z.boolean().default(false),
    excludedAreas: z.array(z.string()).optional(),
    focusModes: z
      .array(z.enum(["navigation", "form", "crud", "api", "adversarial"]))
      .optional(),
  })
  .optional();

const BudgetSchema = z
  .object({
    globalTimeLimitSeconds: z.number().int().min(60).default(900),
    maxStepsPerTask: z.number().int().min(5).default(40),
    maxFrontierSize: z.number().int().min(10).default(200),
    maxStateNodes: z.number().int().min(5).default(50),
    /** Abort a worker after this many consecutive steps with no findings, controls, or edges (0 = disabled). */
    stagnationThreshold: z.number().int().min(0).default(8),
  })
  .default({
    globalTimeLimitSeconds: 900,
    maxStepsPerTask: 40,
    maxFrontierSize: 200,
    maxStateNodes: 50,
    stagnationThreshold: 8,
  });

const AutoCaptureSchema = z
  .object({
    consoleErrors: z.boolean().default(true),
    networkErrors: z.boolean().default(true),
    /** Minimum HTTP status code to capture as network error (default: 400). */
    networkErrorMinStatus: z.number().int().min(400).max(599).default(400),
  })
  .default({
    consoleErrors: true,
    networkErrors: true,
    networkErrorMinStatus: 400,
  });

const BrowserSchema = z
  .object({
    headless: z.boolean().default(false),
  })
  .default({
    headless: false,
  });

const LlmSchema = z
  .object({
    requestTimeoutMs: z.number().int().min(100).default(30_000),
  })
  .default({
    requestTimeoutMs: 30_000,
  });

const ConcurrencySchema = z
  .object({
    /** Number of parallel browser workers (default: 1 = sequential). */
    workers: z.number().int().min(1).max(8).default(1),
  })
  .default({
    workers: 1,
  });

const CheckpointSchema = z
  .object({
    /** Save checkpoint every N completed tasks (0 = disabled). */
    intervalTasks: z.number().int().min(0).default(5),
  })
  .default({
    intervalTasks: 5,
  });

const AppContextSchema = z
  .object({
    /** Patterns the agent should consider normal (not bugs). */
    knownPatterns: z.array(z.string()).optional(),
    /** Specific behaviors to ignore when encountered. */
    ignoredBehaviors: z.array(z.string()).optional(),
    /** Explicit NOT-a-bug examples for prompt calibration. */
    notBugs: z.array(z.string()).optional(),
  })
  .optional();

const RepoContextSchema = z
  .object({
    root: z.string().optional(),
    framework: z.enum(["auto", "nextjs", "generic"]).default("auto"),
    hintsFile: z.string().optional(),
    specFile: z.string().optional(),
  })
  .optional();

const BootstrapSchema = z
  .object({
    command: z.string().optional(),
    cwd: z.string().optional(),
    readyUrl: z.string().optional(),
    readyIndicator: z.string().optional(),
    timeoutSeconds: z.number().int().min(5).default(120),
  })
  .optional();

const PolicySchema = z
  .object({
    expectedResponses: z
      .array(
        z.object({
          method: z.string().optional(),
          pathPrefix: z.string(),
          statuses: z.array(z.number().int()),
        })
      )
      .default([]),
    ignoredConsolePatterns: z.array(z.string()).default([]),
  })
  .default({
    expectedResponses: [],
    ignoredConsolePatterns: [],
  });

export const ConfigSchema = z.object({
  targetUrl: z.string().url(),
  appDescription: z.string().min(1),
  auth: AuthSchema,
  models: ModelsSchema,
  mission: MissionSchema,
  budget: BudgetSchema,
  exploration: ExplorationSchema,
  output: OutputSchema,
  memory: MemorySchema,
  visualRegression: VisualRegressionSchema,
  apiTesting: ApiTestingSchema,
  adversarial: AdversarialSchema,
  judge: JudgeSchema,
  autoCapture: AutoCaptureSchema,
  browser: BrowserSchema,
  llm: LlmSchema,
  concurrency: ConcurrencySchema,
  checkpoint: CheckpointSchema,
  appContext: AppContextSchema,
  repoContext: RepoContextSchema,
  bootstrap: BootstrapSchema,
  policy: PolicySchema,
});

export type DramaturgeConfig = z.infer<typeof ConfigSchema>;
export type LoadedDramaturgeConfig = ConfigWithMeta<DramaturgeConfig>;
export type ApiTestingConfig = z.infer<typeof ApiTestingSchema>;
export type AdversarialConfig = z.infer<typeof AdversarialSchema>;
export type JudgeConfig = z.infer<typeof JudgeSchema>;
export type { ConfigFileContext, LoadedConfigMeta } from "./config-paths.js";
export type FormAuthField = Extract<DramaturgeConfig["auth"], { type: "form" }>["fields"][number];
export type FormAuthSubmit = Extract<DramaturgeConfig["auth"], { type: "form" }>["submit"];
export type OAuthRedirectStep = Extract<DramaturgeConfig["auth"], { type: "oauth-redirect" }>["steps"][number];

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

export function loadConfig(configPath?: string): LoadedDramaturgeConfig {
  const context = getConfigFileContext(configPath);
  let raw: string;
  try {
    raw = readFileSync(context.configPath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${context.configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = parseJsoncObject(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${context.configPath}`);
  }

  const interpolated = interpolateEnvVars(parsed);
  return normalizeConfigPaths(ConfigSchema.parse(interpolated), context);
}

export function resolveWorkerModel(
  config: DramaturgeConfig,
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

export function resolveAgentMode(
  config: DramaturgeConfig,
  workerType: string
): "cua" | "dom" {
  const perType = config.models.agentModes;
  if (perType) {
    const specific = (perType as Record<string, "cua" | "dom" | undefined>)[workerType];
    if (specific) return specific;
  }
  return config.models.agentMode;
}
