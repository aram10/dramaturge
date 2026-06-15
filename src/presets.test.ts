// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { PRESET_NAMES, buildPreset, isPresetName, type PresetName } from './presets.js';
import { applyConfigPreset } from './config.js';

describe('isPresetName', () => {
  it('accepts every known preset name', () => {
    for (const name of PRESET_NAMES) {
      expect(isPresetName(name)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isPresetName('bogus')).toBe(false);
    expect(isPresetName(42)).toBe(false);
    expect(isPresetName(undefined)).toBe(false);
    expect(isPresetName({ preset: 'smoke' })).toBe(false);
  });
});

describe('buildPreset', () => {
  it('returns a fresh object each call so callers cannot mutate shared state', () => {
    const first = buildPreset('smoke');
    const second = buildPreset('smoke');
    expect(first).not.toBe(second);
    expect(first.budget).not.toBe(second.budget);
    expect(first).toEqual(second);
  });

  it('security preset enables adversarial and api probing', () => {
    const preset = buildPreset('security');
    expect(preset.adversarial?.enabled).toBe(true);
    expect(preset.adversarial?.includeAuthzProbes).toBe(true);
    expect(preset.apiTesting?.enabled).toBe(true);
  });
});

describe('applyConfigPreset', () => {
  it('returns the input unchanged when no preset key is present', () => {
    const raw = { targetUrl: 'https://example.com', appDescription: 'demo' };
    expect(applyConfigPreset(raw)).toBe(raw);
  });

  it('returns non-object inputs unchanged', () => {
    expect(applyConfigPreset(null)).toBe(null);
    expect(applyConfigPreset('string')).toBe('string');
  });

  it('expands a preset and strips the preset key', () => {
    const result = applyConfigPreset({
      targetUrl: 'https://example.com',
      appDescription: 'demo',
      preset: 'smoke',
    }) as Record<string, unknown>;

    expect('preset' in result).toBe(false);
    expect(result.budget).toMatchObject({ maxStepsPerTask: 20 });
    expect(result.exploration).toMatchObject({ maxAreasToExplore: 3 });
  });

  it('lets explicit user values win while preserving untouched preset keys', () => {
    const result = applyConfigPreset({
      targetUrl: 'https://example.com',
      appDescription: 'demo',
      preset: 'smoke',
      budget: { globalTimeLimitSeconds: 999 },
    }) as { budget: Record<string, unknown> };

    // User override wins.
    expect(result.budget.globalTimeLimitSeconds).toBe(999);
    // Sibling preset keys survive the deep merge.
    expect(result.budget.maxStepsPerTask).toBe(20);
  });

  it('throws a helpful error for an unknown preset name', () => {
    expect(() =>
      applyConfigPreset({
        targetUrl: 'https://example.com',
        appDescription: 'demo',
        preset: 'bogus',
      })
    ).toThrow(/unknown preset "bogus".*Valid presets:/s);
  });

  it('throws for a non-string preset value', () => {
    expect(() =>
      applyConfigPreset({
        targetUrl: 'https://example.com',
        appDescription: 'demo',
        preset: 123 as unknown as PresetName,
      })
    ).toThrow(/unknown preset/);
  });
});
