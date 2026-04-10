// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildConfigFromArgs } from './config-inline.js';

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
});
