// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { resolve } from 'node:path';
import { ConfigSchema, type DramaturgeConfig } from './config.js';
import { normalizeConfigPaths, type ConfigWithMeta } from './config-paths.js';

export interface InlineRunArgs {
  url: string;
  login?: boolean;
  headless?: boolean;
  provider?: 'anthropic' | 'openai' | 'google';
  preset?: 'smoke' | 'thorough';
  description?: string;
}

const PROVIDER_DEFAULTS: Record<string, { planner: string; worker: string }> = {
  anthropic: {
    planner: 'anthropic/claude-sonnet-4-6',
    worker: 'anthropic/claude-haiku-4-5',
  },
  openai: {
    planner: 'openai/gpt-4.1',
    worker: 'openai/gpt-4.1-mini',
  },
  google: {
    planner: 'google/gemini-2.5-pro',
    worker: 'google/gemini-2.5-flash',
  },
};

function detectProvider(): string {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google';
  return 'anthropic';
}

function buildSmokePreset(): Partial<DramaturgeConfig> {
  return {
    budget: {
      globalTimeLimitSeconds: 180,
      maxStepsPerTask: 20,
      maxFrontierSize: 30,
      maxStateNodes: 10,
      stagnationThreshold: 5,
      costLimitUsd: 0,
    },
    exploration: {
      maxAreasToExplore: 3,
      stepsPerArea: 20,
      totalTimeout: 180,
    },
  };
}

function buildThoroughPreset(): Partial<DramaturgeConfig> {
  return {
    budget: {
      globalTimeLimitSeconds: 1800,
      maxStepsPerTask: 60,
      maxFrontierSize: 300,
      maxStateNodes: 80,
      stagnationThreshold: 8,
      costLimitUsd: 0,
    },
    exploration: {
      maxAreasToExplore: 20,
      stepsPerArea: 60,
      totalTimeout: 1800,
    },
  };
}

/**
 * Build a valid `DramaturgeConfig` from inline CLI arguments with sensible
 * defaults. This enables `dramaturge run <url>` without a config file.
 */
export function buildConfigFromArgs(args: InlineRunArgs): ConfigWithMeta<DramaturgeConfig> {
  const provider = args.provider ?? detectProvider();
  const models = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.anthropic;

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
      format: 'markdown',
      screenshots: true,
    },
  };

  if (args.preset === 'smoke') {
    Object.assign(raw, buildSmokePreset());
  } else if (args.preset === 'thorough') {
    Object.assign(raw, buildThoroughPreset());
  }

  const validated = ConfigSchema.parse(raw);

  const configDir = resolve(process.cwd());
  return normalizeConfigPaths(validated, {
    configPath: resolve(configDir, 'dramaturge.config.json'),
    configDir,
  });
}
