// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { resolve } from 'node:path';
import { ConfigSchema, type DramaturgeConfig } from './config.js';
import { normalizeConfigPaths, type ConfigWithMeta } from './config-paths.js';
import { detectProviderFromEnv } from './llm/index.js';
import type { ProviderId } from './llm/index.js';

export type FocusMode = 'navigation' | 'form' | 'crud' | 'api' | 'adversarial';

export const PRESET_NAMES = [
  'smoke',
  'thorough',
  'security',
  'accessibility',
  'api-contract',
  'visual',
  'pre-release',
] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

export const FOCUS_MODES: readonly FocusMode[] = [
  'navigation',
  'form',
  'crud',
  'api',
  'adversarial',
];

export interface InlineRunArgs {
  url: string;
  login?: boolean;
  headless?: boolean;
  provider?: ProviderId;
  preset?: PresetName;
  focusModes?: FocusMode[];
  description?: string;
  formats?: Array<'markdown' | 'json' | 'both' | 'junit' | 'sarif'>;
}

function resolveProviderDefaults(provider: ProviderId): { planner: string; worker: string } {
  switch (provider) {
    case 'anthropic':
      return {
        planner: 'anthropic/claude-sonnet-4-6',
        worker: 'anthropic/claude-haiku-4-5',
      };
    case 'openai':
      return { planner: 'openai/gpt-4.1', worker: 'openai/gpt-4.1-mini' };
    case 'google':
      return { planner: 'google/gemini-2.5-pro', worker: 'google/gemini-2.5-flash' };
    case 'azure':
      return { planner: 'azure/gpt-4.1', worker: 'azure/gpt-4.1-mini' };
    case 'openrouter':
      return {
        planner: 'openrouter/anthropic/claude-sonnet-4-6',
        worker: 'openrouter/anthropic/claude-haiku-4-5',
      };
    case 'github':
      return { planner: 'github/openai/gpt-4.1', worker: 'github/openai/gpt-4.1-mini' };
    case 'ollama':
      return {
        planner: process.env.OLLAMA_PLANNER_MODEL
          ? `ollama/${process.env.OLLAMA_PLANNER_MODEL}`
          : 'ollama/llama3.1:70b',
        worker: process.env.OLLAMA_WORKER_MODEL
          ? `ollama/${process.env.OLLAMA_WORKER_MODEL}`
          : 'ollama/llama3.1:8b',
      };
    case 'custom': {
      const plannerModel = process.env.OPENAI_COMPATIBLE_PLANNER_MODEL?.trim();
      const workerModel = process.env.OPENAI_COMPATIBLE_WORKER_MODEL?.trim();

      if (!plannerModel || !workerModel) {
        throw new Error(
          'Custom provider requires OPENAI_COMPATIBLE_PLANNER_MODEL and ' +
            'OPENAI_COMPATIBLE_WORKER_MODEL to be set for inline mode.'
        );
      }

      return {
        planner: `custom/${plannerModel}`,
        worker: `custom/${workerModel}`,
      };
    }
  }
}

const SMOKE_BUDGET = {
  globalTimeLimitSeconds: 180,
  maxStepsPerTask: 20,
  maxFrontierSize: 30,
  maxStateNodes: 10,
  stagnationThreshold: 5,
  costLimitUsd: 0,
};

const SMOKE_EXPLORATION = {
  maxAreasToExplore: 3,
  stepsPerArea: 20,
  totalTimeout: 180,
};

const MEDIUM_BUDGET = {
  globalTimeLimitSeconds: 600,
  maxStepsPerTask: 40,
  maxFrontierSize: 100,
  maxStateNodes: 30,
  stagnationThreshold: 6,
  costLimitUsd: 0,
};

const MEDIUM_EXPLORATION = {
  maxAreasToExplore: 8,
  stepsPerArea: 40,
  totalTimeout: 600,
};

const THOROUGH_BUDGET = {
  globalTimeLimitSeconds: 1800,
  maxStepsPerTask: 60,
  maxFrontierSize: 300,
  maxStateNodes: 80,
  stagnationThreshold: 8,
  costLimitUsd: 0,
};

const THOROUGH_EXPLORATION = {
  maxAreasToExplore: 20,
  stepsPerArea: 60,
  totalTimeout: 1800,
};

export function buildSmokePreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...SMOKE_BUDGET },
    exploration: { ...SMOKE_EXPLORATION },
  };
}

export function buildThoroughPreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...THOROUGH_BUDGET },
    exploration: { ...THOROUGH_EXPLORATION },
  };
}

export function buildSecurityPreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...MEDIUM_BUDGET },
    exploration: { ...MEDIUM_EXPLORATION },
    mission: {
      destructiveActionsAllowed: false,
      focusModes: ['adversarial', 'api'],
    },
    adversarial: {
      enabled: true,
      maxSequencesPerNode: 3,
      safeMode: true,
      includeAuthzProbes: true,
      includeConcurrencyProbes: false,
    },
    apiTesting: {
      enabled: true,
      maxEndpointsPerNode: 4,
      maxProbeCasesPerEndpoint: 6,
      unauthenticatedProbes: true,
      allowMutatingProbes: false,
    },
  };
}

export function buildAccessibilityPreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...MEDIUM_BUDGET },
    exploration: { ...MEDIUM_EXPLORATION },
    mission: {
      destructiveActionsAllowed: false,
      focusModes: ['navigation', 'form'],
    },
    responsiveRegression: {
      enabled: true,
    },
  };
}

export function buildApiContractPreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...MEDIUM_BUDGET },
    exploration: { ...MEDIUM_EXPLORATION },
    mission: {
      destructiveActionsAllowed: false,
      focusModes: ['api'],
    },
    apiTesting: {
      enabled: true,
      maxEndpointsPerNode: 6,
      maxProbeCasesPerEndpoint: 8,
      unauthenticatedProbes: true,
      allowMutatingProbes: false,
    },
  };
}

export function buildVisualPreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...MEDIUM_BUDGET },
    exploration: { ...MEDIUM_EXPLORATION },
    mission: {
      destructiveActionsAllowed: false,
      focusModes: ['navigation'],
    },
    visualRegression: {
      enabled: true,
      baselineDir: './.dramaturge/visual-baselines',
      diffPixelRatioThreshold: 0.01,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    },
    responsiveRegression: {
      enabled: true,
    },
    visionAnalysis: {
      enabled: true,
      model: 'anthropic/claude-sonnet-4-20250514',
      fullPage: false,
      maxResponseTokens: 1024,
      requestTimeoutMs: 30_000,
    },
  };
}

export function buildPreReleasePreset(): Partial<DramaturgeConfig> {
  return {
    budget: { ...THOROUGH_BUDGET },
    exploration: { ...THOROUGH_EXPLORATION },
    mission: {
      destructiveActionsAllowed: false,
      focusModes: ['navigation', 'form', 'crud', 'api', 'adversarial'],
    },
    adversarial: {
      enabled: true,
      maxSequencesPerNode: 3,
      safeMode: true,
      includeAuthzProbes: true,
      includeConcurrencyProbes: false,
    },
    apiTesting: {
      enabled: true,
      maxEndpointsPerNode: 4,
      maxProbeCasesPerEndpoint: 6,
      unauthenticatedProbes: true,
      allowMutatingProbes: false,
    },
    visualRegression: {
      enabled: true,
      baselineDir: './.dramaturge/visual-baselines',
      diffPixelRatioThreshold: 0.01,
      includeAA: false,
      fullPage: true,
      maskSelectors: [],
    },
    responsiveRegression: {
      enabled: true,
    },
    webVitals: {
      enabled: true,
      thresholds: { lcpMs: 2500, cls: 0.1, inpMs: 200 },
    },
    visionAnalysis: {
      enabled: true,
      model: 'anthropic/claude-sonnet-4-20250514',
      fullPage: false,
      maxResponseTokens: 1024,
      requestTimeoutMs: 30_000,
    },
  };
}

const PRESET_BUILDERS: Record<PresetName, () => Partial<DramaturgeConfig>> = {
  smoke: buildSmokePreset,
  thorough: buildThoroughPreset,
  security: buildSecurityPreset,
  accessibility: buildAccessibilityPreset,
  'api-contract': buildApiContractPreset,
  visual: buildVisualPreset,
  'pre-release': buildPreReleasePreset,
};

export function buildPreset(name: PresetName): Partial<DramaturgeConfig> {
  return PRESET_BUILDERS[name]();
}

/**
 * Build a valid `DramaturgeConfig` from inline CLI arguments with sensible
 * defaults. This enables `dramaturge run <url>` without a config file.
 */
export function buildConfigFromArgs(args: InlineRunArgs): ConfigWithMeta<DramaturgeConfig> {
  const provider = args.provider ?? detectProviderFromEnv();
  const models = resolveProviderDefaults(provider);

  const raw: Record<string, unknown> = {
    targetUrl: args.url,
    appDescription: args.description ?? `Web application at ${new URL(args.url).hostname}`,
    auth: args.login
      ? {
          type: 'interactive',
          loginUrl: args.url,
          successIndicator: `url:${new URL(args.url).origin}`,
          stateFile: './.dramaturge-state/user.json',
          manualTimeoutSeconds: 120,
        }
      : { type: 'none' },
    models: {
      planner: models.planner,
      worker: models.worker,
      agentMode: 'cua',
    },
    browser: {
      headless: args.headless ?? false,
    },
    output: {
      dir: './dramaturge-reports',
      format:
        args.formats && args.formats.length > 0
          ? args.formats.length === 1
            ? args.formats[0]
            : [...args.formats]
          : 'markdown',
      screenshots: true,
    },
  };

  if (args.preset) {
    Object.assign(raw, buildPreset(args.preset));
  }

  if (args.focusModes && args.focusModes.length > 0) {
    const uniqueFocus = [...new Set(args.focusModes)];
    const existingMission = raw.mission as Partial<DramaturgeConfig['mission']> | undefined;
    raw.mission = {
      ...(existingMission ?? { destructiveActionsAllowed: false }),
      focusModes: uniqueFocus,
    } satisfies Partial<DramaturgeConfig['mission']>;
    if (uniqueFocus.includes('adversarial')) {
      const existing = raw.adversarial as Partial<DramaturgeConfig['adversarial']> | undefined;
      raw.adversarial = {
        ...existing,
        enabled: true,
      } satisfies Partial<DramaturgeConfig['adversarial']>;
    }
    if (uniqueFocus.includes('api')) {
      const existing = raw.apiTesting as Partial<DramaturgeConfig['apiTesting']> | undefined;
      raw.apiTesting = {
        ...existing,
        enabled: true,
      } satisfies Partial<DramaturgeConfig['apiTesting']>;
    }
  }

  const validated = ConfigSchema.parse(raw);

  const configDir = resolve(process.cwd());
  return normalizeConfigPaths(validated, {
    configPath: resolve(configDir, 'dramaturge.config.json'),
    configDir,
  });
}
