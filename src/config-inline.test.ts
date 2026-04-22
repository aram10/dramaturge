// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAccessibilityPreset,
  buildApiContractPreset,
  buildConfigFromArgs,
  buildPreReleasePreset,
  buildSecurityPreset,
  buildSmokePreset,
  buildThoroughPreset,
  buildVisualPreset,
} from './config-inline.js';

describe('buildConfigFromArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a valid config from a URL', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com' });
    expect(config.targetUrl).toBe('https://example.com');
    expect(config.auth.type).toBe('none');
    expect(config.browser.headless).toBe(false);
    expect(config._meta).toBeDefined();
  });

  it('enables interactive auth when login is true', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', login: true });
    expect(config.auth.type).toBe('interactive');
  });

  it('sets headless mode', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', headless: true });
    expect(config.browser.headless).toBe(true);
  });

  it('uses openai models when provider is openai', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', provider: 'openai' });
    expect(config.models.planner).toContain('openai');
    expect(config.models.worker).toContain('openai');
  });

  it('uses google models when provider is google', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', provider: 'google' });
    expect(config.models.planner).toContain('google');
    expect(config.models.worker).toContain('google');
  });

  it('applies smoke preset', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'smoke' });
    expect(config.budget.globalTimeLimitSeconds).toBe(180);
    expect(config.exploration.maxAreasToExplore).toBe(3);
  });

  it('applies thorough preset', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'thorough' });
    expect(config.budget.globalTimeLimitSeconds).toBe(1800);
    expect(config.exploration.maxAreasToExplore).toBe(20);
  });

  it('uses custom description', () => {
    const config = buildConfigFromArgs({
      url: 'https://example.com',
      description: 'My test app',
    });
    expect(config.appDescription).toBe('My test app');
  });

  it('generates description from hostname when not provided', () => {
    const config = buildConfigFromArgs({ url: 'https://my-app.example.com/path' });
    expect(config.appDescription).toContain('my-app.example.com');
  });

  it('applies security preset with adversarial+api focus and feature toggles', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'security' });
    expect(config.mission?.focusModes).toEqual(['adversarial', 'api']);
    expect(config.adversarial.enabled).toBe(true);
    expect(config.adversarial.includeAuthzProbes).toBe(true);
    expect(config.apiTesting.enabled).toBe(true);
    expect(config.budget.globalTimeLimitSeconds).toBe(600);
  });

  it('applies accessibility preset', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'accessibility' });
    expect(config.mission?.focusModes).toEqual(['navigation', 'form']);
    expect(config.responsiveRegression.enabled).toBe(true);
    expect(config.adversarial.enabled).toBe(false);
  });

  it('applies api-contract preset', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'api-contract' });
    expect(config.mission?.focusModes).toEqual(['api']);
    expect(config.apiTesting.enabled).toBe(true);
    expect(config.adversarial.enabled).toBe(false);
  });

  it('applies visual preset', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'visual' });
    expect(config.mission?.focusModes).toEqual(['navigation']);
    expect(config.visualRegression.enabled).toBe(true);
    expect(config.responsiveRegression.enabled).toBe(true);
    expect(config.visionAnalysis.enabled).toBe(true);
  });

  it('applies pre-release preset covering all dimensions', () => {
    const config = buildConfigFromArgs({ url: 'https://example.com', preset: 'pre-release' });
    expect(config.mission?.focusModes).toEqual([
      'navigation',
      'form',
      'crud',
      'api',
      'adversarial',
    ]);
    expect(config.adversarial.enabled).toBe(true);
    expect(config.apiTesting.enabled).toBe(true);
    expect(config.visualRegression.enabled).toBe(true);
    expect(config.responsiveRegression.enabled).toBe(true);
    expect(config.webVitals.enabled).toBe(true);
    expect(config.visionAnalysis.enabled).toBe(true);
    expect(config.budget.globalTimeLimitSeconds).toBe(1800);
  });

  it('--focus overrides preset focus modes', () => {
    const config = buildConfigFromArgs({
      url: 'https://example.com',
      preset: 'smoke',
      focusModes: ['api', 'adversarial'],
    });
    expect(config.mission?.focusModes).toEqual(['api', 'adversarial']);
    expect(config.apiTesting.enabled).toBe(true);
    expect(config.adversarial.enabled).toBe(true);
  });

  it('--focus alone sets focus modes without a preset', () => {
    const config = buildConfigFromArgs({
      url: 'https://example.com',
      focusModes: ['form'],
    });
    expect(config.mission?.focusModes).toEqual(['form']);
    expect(config.apiTesting.enabled).toBe(false);
    expect(config.adversarial.enabled).toBe(false);
  });

  it('--focus de-duplicates repeated values', () => {
    const config = buildConfigFromArgs({
      url: 'https://example.com',
      focusModes: ['api', 'api', 'form'],
    });
    expect(config.mission?.focusModes).toEqual(['api', 'form']);
  });

  it('preserves security preset feature toggles when focus narrows to api', () => {
    const config = buildConfigFromArgs({
      url: 'https://example.com',
      preset: 'security',
      focusModes: ['api'],
    });
    expect(config.mission?.focusModes).toEqual(['api']);
    expect(config.apiTesting.enabled).toBe(true);
    expect(config.adversarial.enabled).toBe(true);
  });
});

describe('preset builders', () => {
  it('smoke preset is unchanged', () => {
    const preset = buildSmokePreset();
    expect(preset.budget?.globalTimeLimitSeconds).toBe(180);
    expect(preset.exploration?.maxAreasToExplore).toBe(3);
    expect(preset.mission).toBeUndefined();
  });

  it('thorough preset is unchanged', () => {
    const preset = buildThoroughPreset();
    expect(preset.budget?.globalTimeLimitSeconds).toBe(1800);
    expect(preset.mission).toBeUndefined();
  });

  it('security preset sets adversarial+api focus', () => {
    const preset = buildSecurityPreset();
    expect(preset.mission?.focusModes).toEqual(['adversarial', 'api']);
    expect(preset.adversarial?.enabled).toBe(true);
    expect(preset.apiTesting?.enabled).toBe(true);
  });

  it('accessibility preset sets navigation+form focus and responsive checks', () => {
    const preset = buildAccessibilityPreset();
    expect(preset.mission?.focusModes).toEqual(['navigation', 'form']);
    expect(preset.responsiveRegression?.enabled).toBe(true);
  });

  it('api-contract preset focuses on api only', () => {
    const preset = buildApiContractPreset();
    expect(preset.mission?.focusModes).toEqual(['api']);
    expect(preset.apiTesting?.enabled).toBe(true);
  });

  it('visual preset enables visual/responsive/vision checks', () => {
    const preset = buildVisualPreset();
    expect(preset.visualRegression?.enabled).toBe(true);
    expect(preset.responsiveRegression?.enabled).toBe(true);
    expect(preset.visionAnalysis?.enabled).toBe(true);
  });

  it('pre-release preset enables all coverage dimensions', () => {
    const preset = buildPreReleasePreset();
    expect(preset.adversarial?.enabled).toBe(true);
    expect(preset.apiTesting?.enabled).toBe(true);
    expect(preset.visualRegression?.enabled).toBe(true);
    expect(preset.responsiveRegression?.enabled).toBe(true);
    expect(preset.webVitals?.enabled).toBe(true);
    expect(preset.visionAnalysis?.enabled).toBe(true);
  });
});
