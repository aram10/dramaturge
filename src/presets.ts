// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { DramaturgeConfig } from './config.js';

/**
 * Named configuration presets.
 *
 * A preset is a curated bundle of settings that pre-fills sensible defaults for
 * a common testing scenario, so users (and the inline CLI) only need to touch a
 * handful of knobs instead of the full configuration surface. Presets are
 * available both to the inline CLI (`dramaturge run <url> --preset <name>`) and
 * to config files (`{ "preset": "<name>", ... }`); see `applyConfigPreset` in
 * `config.ts` for the file-based merge semantics.
 */
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

const SMOKE_BUDGET = {
  globalTimeLimitSeconds: 180,
  maxStepsPerTask: 20,
  maxFrontierSize: 30,
  maxStateNodes: 10,
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

export function isPresetName(value: unknown): value is PresetName {
  return typeof value === 'string' && (PRESET_NAMES as readonly string[]).includes(value);
}
