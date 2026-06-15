// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { resolve } from 'node:path';
import { ConfigSchema, type DramaturgeConfig } from './config.js';
import { normalizeConfigPaths, type ConfigWithMeta } from './config-paths.js';
import { detectProviderFromEnv } from './llm/index.js';
import { buildPreset } from './presets.js';
import type { ProviderId } from './llm/index.js';
import type { PresetName } from './presets.js';

export type FocusMode = 'navigation' | 'form' | 'crud' | 'api' | 'adversarial';

// Preset bundles now live in `./presets.js` so they can be shared by the
// config-file loader (`loadConfig`) as well as the inline CLI path below.
// Re-export the public surface for backward compatibility.
export {
  PRESET_NAMES,
  buildPreset,
  buildSmokePreset,
  buildThoroughPreset,
  buildSecurityPreset,
  buildAccessibilityPreset,
  buildApiContractPreset,
  buildVisualPreset,
  buildPreReleasePreset,
} from './presets.js';
export type { PresetName } from './presets.js';

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

export function resolveProviderDefaults(provider: ProviderId): { planner: string; worker: string } {
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
