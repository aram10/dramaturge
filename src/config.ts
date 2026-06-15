// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { parseJsoncObject } from './utils/jsonc.js';
import { getConfigFileContext, normalizeConfigPaths, type ConfigWithMeta } from './config-paths.js';
import { unknownModelPrefix, knownProviderIds } from './llm/registry.js';
import { PRESET_NAMES, buildPreset, isPresetName } from './presets.js';

/**
 * Zod schema for a model string that rejects unknown provider prefixes (#224).
 * A bare model name (no `/`) or a recognised `<provider>/<model>` string passes;
 * `foo/bar` fails fast instead of silently falling back to Anthropic.
 */
const ModelString = z.string().superRefine((value, ctx) => {
  const bad = unknownModelPrefix(value);
  if (bad) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown model provider prefix "${bad}/". Known providers: ${knownProviderIds().join(', ')}. Use a bare model name for the default (Anthropic) provider.`,
    });
  }
});

const AuthConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('none'),
  }),
  z.object({
    type: z.literal('stored-state'),
    stateFile: z.string(),
    successIndicator: z.string().optional(),
  }),
  z.object({
    type: z.literal('form'),
    loginUrl: z.string(),
    fields: z
      .array(
        z.object({
          selector: z.string().min(1),
          value: z.string(),
          label: z.string().optional(),
          secret: z.boolean().default(false),
        })
      )
      .min(1),
    submit: z.object({
      selector: z.string().min(1),
      label: z.string().optional(),
    }),
    successIndicator: z.string(),
  }),
  z.object({
    type: z.literal('oauth-redirect'),
    loginUrl: z.string(),
    steps: z
      .array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('click'),
            selector: z.string().min(1),
            label: z.string().optional(),
          }),
          z.object({
            type: z.literal('fill'),
            selector: z.string().min(1),
            value: z.string(),
            label: z.string().optional(),
            secret: z.boolean().default(false),
          }),
          z.object({
            type: z.literal('wait-for-selector'),
            selector: z.string().min(1),
          }),
        ])
      )
      .min(1),
    successIndicator: z.string(),
  }),
  z.object({
    type: z.literal('interactive'),
    loginUrl: z.string(),
    successIndicator: z.string(),
    stateFile: z.string().default('./.dramaturge-state/user.json'),
    /** Timeout in seconds for the human to complete login (default: 120). */
    manualTimeoutSeconds: z.number().int().min(30).default(120),
  }),
]);

const AuthProfilesSchema = z
  .object({
    profiles: z
      .record(z.string().min(1), AuthConfigSchema)
      .refine((profiles) => Object.keys(profiles).length > 0, {
        message: 'At least one auth profile is required when using profiles.',
      }),
    default: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !value.default || value.profiles[value.default] !== undefined, {
    message: 'The default profile must exist in the profiles object.',
  });

const AuthSchema = z.union([AuthProfilesSchema, AuthConfigSchema]).default({ type: 'none' });

const WorkerModelsSchema = z
  .object({
    navigation: ModelString.optional(),
    form: ModelString.optional(),
    crud: ModelString.optional(),
    api: ModelString.optional(),
    adversarial: ModelString.optional(),
  })
  .strict()
  .optional();

const AgentModeSchema = z.enum(['cua', 'dom']).default('cua');

const AgentModesSchema = z
  .object({
    navigation: z.enum(['cua', 'dom']).optional(),
    form: z.enum(['cua', 'dom']).optional(),
    crud: z.enum(['cua', 'dom']).optional(),
    api: z.enum(['cua', 'dom']).optional(),
    adversarial: z.enum(['cua', 'dom']).optional(),
  })
  .strict()
  .optional();

const ModelsSchema = z
  .object({
    planner: ModelString.default('anthropic/claude-sonnet-4-6'),
    worker: ModelString.default('anthropic/claude-haiku-4-5'),
    browserOps: ModelString.optional(),
    workers: WorkerModelsSchema,
    agentMode: AgentModeSchema,
    agentModes: AgentModesSchema,
  })
  .strict()
  .default({
    planner: 'anthropic/claude-sonnet-4-6',
    worker: 'anthropic/claude-haiku-4-5',
    agentMode: 'cua',
  });

const ExplorationSchema = z
  .object({
    maxAreasToExplore: z.number().int().min(0).default(10),
    stepsPerArea: z.number().int().min(1).default(40),
    totalTimeout: z.number().int().min(1).default(900),
  })
  .strict()
  .default({
    maxAreasToExplore: 10,
    stepsPerArea: 40,
    totalTimeout: 900,
  });

const OutputFormatValueSchema = z.enum(['markdown', 'json', 'both', 'junit', 'sarif']);
export type OutputFormatValue = z.infer<typeof OutputFormatValueSchema>;

const OutputFormatSchema = z.union([
  OutputFormatValueSchema,
  z.array(OutputFormatValueSchema).min(1),
]);

const OutputSchema = z
  .object({
    dir: z.string().default('./dramaturge-reports'),
    format: OutputFormatSchema.default('markdown'),
    screenshots: z.boolean().default(true),
  })
  .default({
    dir: './dramaturge-reports',
    format: 'markdown',
    screenshots: true,
  });

/**
 * Normalize the output.format config value into a de-duplicated list of
 * concrete renderer names. The legacy `'both'` alias expands to
 * `['markdown', 'json']`.
 */
export function resolveOutputFormats(
  format: OutputFormatValue | OutputFormatValue[]
): Array<'markdown' | 'json' | 'junit' | 'sarif'> {
  const list = Array.isArray(format) ? format : [format];
  const resolved = new Set<'markdown' | 'json' | 'junit' | 'sarif'>();
  for (const value of list) {
    if (value === 'both') {
      resolved.add('markdown');
      resolved.add('json');
    } else {
      resolved.add(value);
    }
  }
  return [...resolved];
}

const MemorySchema = z
  .object({
    enabled: z.boolean().default(false),
    dir: z.string().default('./.dramaturge'),
    warmStart: z.boolean().default(true),
  })
  .default({
    enabled: false,
    dir: './.dramaturge',
    warmStart: true,
  });

const VisualRegressionSchema = z
  .object({
    enabled: z.boolean().default(false),
    baselineDir: z.string().default('./.dramaturge/visual-baselines'),
    diffPixelRatioThreshold: z.number().min(0).max(1).default(0.01),
    includeAA: z.boolean().default(false),
    fullPage: z.boolean().default(true),
    maskSelectors: z.array(z.string()).default([]),
  })
  .default({
    enabled: false,
    baselineDir: './.dramaturge/visual-baselines',
    diffPixelRatioThreshold: 0.01,
    includeAA: false,
    fullPage: true,
    maskSelectors: [],
  });

const WebVitalsSchema = z
  .object({
    enabled: z.boolean().default(false),
    thresholds: z
      .object({
        lcpMs: z.number().min(0).default(2500),
        cls: z.number().min(0).default(0.1),
        inpMs: z.number().min(0).default(200),
      })
      .default({
        lcpMs: 2500,
        cls: 0.1,
        inpMs: 200,
      }),
  })
  .default({
    enabled: false,
    thresholds: {
      lcpMs: 2500,
      cls: 0.1,
      inpMs: 200,
    },
  });

const ResponsiveRegressionSchema = z
  .object({
    enabled: z.boolean().default(false),
    breakpoints: z
      .array(
        z.object({
          name: z.string().min(1),
          width: z.number().int().min(1),
          height: z.number().int().min(1),
        })
      )
      .optional(),
  })
  .default({
    enabled: false,
  });

const VisionAnalysisSchema = z
  .object({
    /** Enable vision-based page understanding during preflight scans. */
    enabled: z.boolean().default(false),
    /** LLM model to use for vision analysis (must support image input). */
    model: z.string().default('anthropic/claude-sonnet-4-20250514'),
    /** Capture full-page screenshots for vision analysis. */
    fullPage: z.boolean().default(false),
    /** Maximum tokens for the vision model response. */
    maxResponseTokens: z.number().int().min(64).default(1024),
    /** Request timeout in milliseconds for vision API calls. */
    requestTimeoutMs: z.number().int().min(1000).default(30_000),
  })
  .default({
    enabled: false,
    model: 'anthropic/claude-sonnet-4-20250514',
    fullPage: false,
    maxResponseTokens: 1024,
    requestTimeoutMs: 30_000,
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
    /** Drop findings the judge rejects instead of shipping them (#206). */
    dropRejected: z.boolean().default(true),
    /** Minimum confidence a finding must carry to be reported (#206). */
    minConfidence: z.enum(['low', 'medium', 'high']).default('low'),
  })
  .default({
    enabled: true,
    requestTimeoutMs: 15_000,
    dropRejected: true,
    minConfidence: 'low',
  });

const MissionSchema = z
  .object({
    criticalFlows: z.array(z.string()).optional(),
    destructiveActionsAllowed: z.boolean().default(false),
    excludedAreas: z.array(z.string()).optional(),
    focusModes: z.array(z.enum(['navigation', 'form', 'crud', 'api', 'adversarial'])).optional(),
  })
  .optional();

const BudgetSchema = z
  .object({
    globalTimeLimitSeconds: z.number().int().min(60).default(900),
    /**
     * Hard timeout (in seconds) for an individual worker task.
     *
     * When unset, the engine derives a per-task timeout from the remaining global budget.
     */
    taskTimeLimitSeconds: z.number().int().min(5).optional(),
    maxStepsPerTask: z.number().int().min(5).default(40),
    maxFrontierSize: z.number().int().min(10).default(200),
    maxStateNodes: z.number().int().min(5).default(50),
    /**
     * Maximum estimated LLM cost in USD before stopping the run (0 = unlimited).
     * Enforced by the engine: when exceeded, the run stops dequeuing new tasks
     * and the report is marked partial (reason: cost-budget-exceeded).
     */
    costLimitUsd: z.number().min(0).default(0),
  })
  .default({
    globalTimeLimitSeconds: 900,
    maxStepsPerTask: 40,
    maxFrontierSize: 200,
    maxStateNodes: 50,
    costLimitUsd: 0,
  });

const AutoCaptureSchema = z
  .object({
    consoleErrors: z.boolean().default(true),
    consoleWarnings: z.boolean().default(false),
    networkErrors: z.boolean().default(true),
    /** Minimum HTTP status code to capture as network error (default: 400). */
    networkErrorMinStatus: z.number().int().min(400).max(599).default(400),
  })
  .default({
    consoleErrors: true,
    consoleWarnings: false,
    networkErrors: true,
    networkErrorMinStatus: 400,
  });

const AutoValidateSchema = z
  .object({
    /** Replay high-impact findings to validate them before reporting (#137). */
    enabled: z.boolean().default(false),
    /** Severities considered high-impact and validated. */
    severities: z
      .array(z.enum(['Critical', 'Major', 'Minor', 'Trivial']))
      .default(['Critical', 'Major']),
    /** Maximum number of findings to validate per run (bounds cost). */
    maxFindings: z.number().int().min(1).max(100).default(10),
  })
  .default({
    enabled: false,
    severities: ['Critical', 'Major'],
    maxFindings: 10,
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

const DiffAwareSchema = z
  .object({
    /** Enable diff-aware exploration mode. */
    enabled: z.boolean().default(false),
    /** Git ref to diff against (e.g. "origin/main"). Overridden by --diff CLI flag. */
    baseRef: z.string().optional(),
    /** When true, restrict exploration to only areas matching the detected diff. */
    restrictToChanged: z.boolean().default(false),
    /** Priority boost applied to state graph nodes matching changed areas (0-1). */
    priorityBoost: z.number().min(0).max(1).default(0.3),
  })
  .default({
    enabled: false,
    restrictToChanged: false,
    priorityBoost: 0.3,
  });

const RepoContextSchema = z
  .object({
    root: z.string().optional(),
    framework: z
      .enum([
        'auto',
        'nextjs',
        'nuxt',
        'sveltekit',
        'remix',
        'astro',
        'react-router',
        'express',
        'vue-router',
        'django',
        'fastapi',
        'rails',
        'tanstack-router',
        'generic',
      ])
      .default('auto'),
    hintsFile: z.string().optional(),
    specFile: z.string().optional(),
  })
  .optional();

const SHELL_METACHARACTER_PATTERN = /\[|]|[|&;<>$`"'()*?{}!#~\n\r]/;

function containsShellMetacharacters(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  return SHELL_METACHARACTER_PATTERN.test(command);
}

const BootstrapSchema = z
  .object({
    mode: z.enum(['trusted', 'safe']).default('trusted'),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    readyUrl: z.string().optional(),
    readyIndicator: z.string().optional(),
    timeoutSeconds: z.number().int().min(5).default(120),
  })
  .refine((value) => value.mode !== 'trusted' || value.args.length === 0, {
    message:
      "bootstrap.args may only be set when bootstrap.mode is 'safe'; in 'trusted' mode, embed arguments in the shell command string instead.",
    path: ['args'],
  })
  .refine(
    (value) =>
      value.mode !== 'safe' || (typeof value.command === 'string' && value.command.length > 0),
    {
      message: "bootstrap.command is required when bootstrap.mode is 'safe'.",
      path: ['command'],
    }
  )
  .refine((value) => value.mode !== 'safe' || !containsShellMetacharacters(value.command), {
    message:
      "bootstrap.command in 'safe' mode must be a plain executable path — shell metacharacters are not allowed. Move flags into bootstrap.args, or switch to 'trusted' mode if a shell is required.",
    path: ['command'],
  })
  .refine((value) => value.mode !== 'safe' || !containsWhitespace(value.command), {
    message:
      "bootstrap.command in 'safe' mode must be a single executable — whitespace is not allowed. Split the command so that the executable is in bootstrap.command and arguments are in bootstrap.args.",
    path: ['command'],
  })
  .refine((value) => value.mode !== 'safe' || !argsContainNullBytes(value.args), {
    message: "bootstrap.args in 'safe' mode must not contain null bytes.",
    path: ['args'],
  })
  .optional();

function containsWhitespace(command: string | undefined): boolean {
  return typeof command === 'string' && /\s/.test(command);
}

function argsContainNullBytes(args: string[] | undefined): boolean {
  return Array.isArray(args) && args.some((arg) => arg.includes('\0'));
}

const SafetyPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    allowedUrlPatterns: z.array(z.string()).default([]),
    blockedUrlPatterns: z.array(z.string()).default([]),
    allowedOrigins: z.array(z.string()).default([]),
    allowCrossOrigin: z.boolean().default(false),
    blockDestructiveRequests: z.boolean().optional(),
    destructiveActionKeywords: z
      .array(z.string())
      .default([
        'delete',
        'remove',
        'destroy',
        'purge',
        'drop',
        'reset all',
        'clear all',
        'wipe',
        'uninstall',
        'deactivate account',
        'close account',
      ]),
    maxAuditEntries: z.number().int().min(1).default(500),
  })
  .default({
    enabled: true,
    allowedUrlPatterns: [],
    blockedUrlPatterns: [],
    allowedOrigins: [],
    allowCrossOrigin: false,
    destructiveActionKeywords: [
      'delete',
      'remove',
      'destroy',
      'purge',
      'drop',
      'reset all',
      'clear all',
      'wipe',
      'uninstall',
      'deactivate account',
      'close account',
    ],
    maxAuditEntries: 500,
  });

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
    safety: SafetyPolicySchema,
  })
  .default({
    expectedResponses: [],
    ignoredConsolePatterns: [],
    safety: {
      enabled: true,
      allowedUrlPatterns: [],
      blockedUrlPatterns: [],
      allowedOrigins: [],
      allowCrossOrigin: false,
      destructiveActionKeywords: [
        'delete',
        'remove',
        'destroy',
        'purge',
        'drop',
        'reset all',
        'clear all',
        'wipe',
        'uninstall',
        'deactivate account',
        'close account',
      ],
      maxAuditEntries: 500,
    },
  });

const A2ASchema = z
  .object({
    /** Enable multi-agent coordination mode (A2A protocol). */
    enabled: z.boolean().default(false),
    /** Maximum number of entries to retain in the blackboard (default: 500). */
    maxBlackboardEntries: z.number().int().min(1).default(500),
    /** Maximum number of messages to retain in the message bus history (default: 500). */
    maxMessageHistory: z.number().int().min(1).default(500),
  })
  .default({
    enabled: false,
    maxBlackboardEntries: 500,
    maxMessageHistory: 500,
  });

const WorkflowAutomataSchema = z
  .object({
    enabled: z.boolean().default(false),
    outputJson: z.boolean().default(true),
    outputMermaid: z.boolean().default(true),
    persistAcrossRuns: z.boolean().default(true),
    includeAuthProfile: z.boolean().default(true),
    includeApiSignals: z.boolean().default(true),
    includeModalState: z.boolean().default(true),
    includeFormValidity: z.boolean().default(true),
    maxStates: z.number().int().min(5).default(200),
    maxTransitions: z.number().int().min(10).default(1000),
    minTransitionObservations: z.number().int().min(1).default(1),
    nondeterminismThreshold: z.number().min(0).max(1).default(0.25),
    lowConfidenceThreshold: z.number().min(0).max(1).default(0.5),
    generateFollowups: z.boolean().default(true),
    maxFollowupsPerRun: z.number().int().min(0).default(20),
    priorityBoost: z.number().min(0).max(1).default(0.2),
    redactValues: z.boolean().default(true),
    destructiveTransitionConfirmationRequired: z.boolean().default(true),
  })
  .default({
    enabled: false,
    outputJson: true,
    outputMermaid: true,
    persistAcrossRuns: true,
    includeAuthProfile: true,
    includeApiSignals: true,
    includeModalState: true,
    includeFormValidity: true,
    maxStates: 200,
    maxTransitions: 1000,
    minTransitionObservations: 1,
    nondeterminismThreshold: 0.25,
    lowConfidenceThreshold: 0.5,
    generateFollowups: true,
    maxFollowupsPerRun: 20,
    priorityBoost: 0.2,
    redactValues: true,
    destructiveTransitionConfirmationRequired: true,
  });

const ExperimentalSchema = z
  .object({
    workflowAutomata: WorkflowAutomataSchema,
  })
  .default(() => ({
    workflowAutomata: WorkflowAutomataSchema.parse({}),
  }));

export const ConfigSchema = z
  .object({
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
    webVitals: WebVitalsSchema,
    responsiveRegression: ResponsiveRegressionSchema,
    visionAnalysis: VisionAnalysisSchema,
    apiTesting: ApiTestingSchema,
    adversarial: AdversarialSchema,
    judge: JudgeSchema,
    autoCapture: AutoCaptureSchema,
    autoValidate: AutoValidateSchema,
    browser: BrowserSchema,
    llm: LlmSchema,
    concurrency: ConcurrencySchema,
    checkpoint: CheckpointSchema,
    appContext: AppContextSchema,
    repoContext: RepoContextSchema,
    diffAware: DiffAwareSchema,
    bootstrap: BootstrapSchema,
    policy: PolicySchema,
    a2a: A2ASchema,
    experimental: ExperimentalSchema,
  })
  .strict();

export type DramaturgeConfig = z.infer<typeof ConfigSchema>;
export type LoadedDramaturgeConfig = ConfigWithMeta<DramaturgeConfig>;
export type ApiTestingConfig = z.infer<typeof ApiTestingSchema>;
export type AdversarialConfig = z.infer<typeof AdversarialSchema>;
export type JudgeConfig = z.infer<typeof JudgeSchema>;
export type VisionAnalysisConfig = z.infer<typeof VisionAnalysisSchema>;
export type WorkflowAutomataConfig = z.infer<typeof WorkflowAutomataSchema>;
export type { ConfigFileContext, LoadedConfigMeta } from './config-paths.js';
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type AuthProfiles = z.infer<typeof AuthProfilesSchema>;
export type FormAuthField = Extract<AuthConfig, { type: 'form' }>['fields'][number];
export type FormAuthSubmit = Extract<AuthConfig, { type: 'form' }>['submit'];
export type OAuthRedirectStep = Extract<AuthConfig, { type: 'oauth-redirect' }>['steps'][number];

/**
 * Check if auth config uses profiles (multi-role) mode.
 */
export function isAuthProfiles(auth: DramaturgeConfig['auth']): auth is AuthProfiles {
  return 'profiles' in auth && typeof auth.profiles === 'object';
}

/**
 * Resolve a specific auth profile by name from the config.
 * Returns the resolved profile or throws if the profile doesn't exist.
 */
export function resolveAuthProfile(
  auth: DramaturgeConfig['auth'],
  profileName?: string
): AuthConfig {
  // If auth is a direct config (backward compatibility), return it
  if (!isAuthProfiles(auth)) {
    return auth;
  }

  // Determine which profile to use
  const targetProfile = profileName ?? auth.default;
  if (!targetProfile) {
    throw new Error(
      'No profile specified and no default profile set. Please specify a profile with --profile or set auth.default in config.'
    );
  }

  // Resolve the profile
  const profile = auth.profiles[targetProfile];
  if (!profile) {
    const available = Object.keys(auth.profiles).join(', ');
    throw new Error(`Auth profile "${targetProfile}" not found. Available profiles: ${available}`);
  }

  return profile;
}

/**
 * Get all profile names from the auth config.
 */
export function getAuthProfileNames(auth: DramaturgeConfig['auth']): string[] {
  if (!isAuthProfiles(auth)) {
    return [];
  }
  return Object.keys(auth.profiles);
}

function interpolateEnvVars(value: unknown, missing: Set<string>): unknown {
  if (typeof value === 'string') {
    // `$${VAR}` is an escape for a literal `${VAR}` (#249). Process escapes and
    // real references in a single pass so an escaped token is never expanded.
    return value.replace(
      /\$(\$)?\{(\w+)\}/g,
      (_match, escaped: string | undefined, varName: string) => {
        if (escaped) {
          return `\${${varName}}`;
        }
        const envVal = process.env[varName];
        if (envVal === undefined) {
          missing.add(varName);
          return '';
        }
        return envVal;
      }
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnvVars(item, missing));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateEnvVars(v, missing),
      ])
    );
  }
  return value;
}

/**
 * Suggest the closest known key for an unrecognised config key using a simple
 * Levenshtein distance, for "did you mean" diagnostics (#223).
 */
function closestKey(unknownKey: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(unknownKey.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // Only suggest when the edit distance is small relative to the key length.
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(unknownKey.length / 2))
    ? best
    : undefined;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i][0] = i;
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
    }
  }
  return dist[rows - 1][cols - 1];
}

const TOP_LEVEL_CONFIG_KEYS = Object.keys(ConfigSchema.shape);

/**
 * Format a Zod validation error as a list of `path: message` lines, adding
 * "did you mean" suggestions for unrecognised top-level keys (#223).
 */
function formatConfigError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    if (issue.code === 'unrecognized_keys') {
      const suggestions = issue.keys
        .map((key) => {
          const suggestion = closestKey(key, TOP_LEVEL_CONFIG_KEYS);
          return suggestion ? `"${key}" (did you mean "${suggestion}"?)` : `"${key}"`;
        })
        .join(', ');
      return `${path}: unknown key(s): ${suggestions}`;
    }
    return `${path}: ${issue.message}`;
  });
  return lines.join('\n');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge two config fragments. Plain objects are merged recursively; arrays
 * and primitives from `override` replace the corresponding `base` value. Used to
 * layer an explicit user config on top of a preset so user values always win
 * while untouched preset keys are preserved.
 */
function deepMergeConfig(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMergeConfig(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

/**
 * Expand a top-level `preset` key in a raw config object into the preset's
 * bundled settings, layering the user's explicit values on top (user wins). The
 * `preset` key is removed so the strict schema never sees it. Inputs without a
 * `preset` key are returned unchanged.
 */
export function applyConfigPreset(raw: unknown): unknown {
  if (!isPlainObject(raw) || !('preset' in raw)) {
    return raw;
  }

  const { preset, ...rest } = raw;
  if (!isPresetName(preset)) {
    const provided = typeof preset === 'string' ? `"${preset}"` : JSON.stringify(preset);
    throw new Error(
      `preset: unknown preset ${provided}. Valid presets: ${PRESET_NAMES.join(', ')}`
    );
  }

  const presetConfig = buildPreset(preset) as Record<string, unknown>;
  return deepMergeConfig(presetConfig, rest);
}

export function loadConfig(configPath?: string): LoadedDramaturgeConfig {
  const context = getConfigFileContext(configPath);
  let raw: string;
  try {
    raw = readFileSync(context.configPath, 'utf-8');
  } catch {
    throw new Error(`Config file not found: ${context.configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = parseJsoncObject(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${context.configPath}`);
  }

  let presetApplied: unknown;
  try {
    presetApplied = applyConfigPreset(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid config file: ${context.configPath}\n${message}`, { cause: error });
  }

  const missing = new Set<string>();
  const interpolated = interpolateEnvVars(presetApplied, missing);
  if (missing.size > 0) {
    const names = [...missing].sort();
    throw new Error(
      `Environment variable${names.length > 1 ? 's' : ''} not set (referenced in config): ${names
        .map((name) => `\${${name}}`)
        .join(', ')}`
    );
  }

  const result = ConfigSchema.safeParse(interpolated);
  if (!result.success) {
    throw new Error(
      `Invalid config file: ${context.configPath}\n${formatConfigError(result.error)}`
    );
  }
  return normalizeConfigPaths(result.data, context);
}

export function resolveWorkerModel(config: DramaturgeConfig, workerType: string): string {
  const perType = config.models.workers;
  if (perType) {
    const specific = (perType as Record<string, string | undefined>)[workerType];
    if (specific) return specific;
  }
  return config.models.worker;
}

export function resolveBrowserOpsModel(config: DramaturgeConfig): string {
  return config.models.browserOps ?? config.models.planner;
}

export function resolveAgentMode(config: DramaturgeConfig, workerType: string): 'cua' | 'dom' {
  const perType = config.models.agentModes;
  if (perType) {
    const specific = (perType as Record<string, 'cua' | 'dom' | undefined>)[workerType];
    if (specific) return specific;
  }
  return config.models.agentMode;
}
