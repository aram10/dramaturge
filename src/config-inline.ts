// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { resolve } from 'node:path';
import { ConfigSchema, type DramaturgeConfig } from './config.js';
import { normalizeConfigPaths, type ConfigWithMeta } from './config-paths.js';
import { detectProviderFromEnv } from './llm/index.js';
import type { ProviderId } from './llm/index.js';

export interface InlineRunArgs {
  url: string;
  login?: boolean;
  headless?: boolean;
  provider?: ProviderId;
  preset?: 'smoke' | 'thorough';
  description?: string;
  formats?: Array<'markdown' | 'json' | 'both' | 'junit' | 'sarif'>;
}

const PROVIDER_DEFAULTS: Record<ProviderId, { planner: string; worker: string }> = {
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
  azure: {
    planner: 'azure/gpt-4.1',
    worker: 'azure/gpt-4.1-mini',
  },
  openrouter: {
    planner: 'openrouter/anthropic/claude-sonnet-4-6',
    worker: 'openrouter/anthropic/claude-haiku-4-5',
  },
  github: {
    planner: 'github/openai/gpt-4.1',
    worker: 'github/openai/gpt-4.1-mini',
  },
};

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
  const provider = args.provider ?? detectProviderFromEnv();
  const models = PROVIDER_DEFAULTS[provider];

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
