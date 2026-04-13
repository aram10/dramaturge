// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { matchesUrlIndicator, parseIndicator } from './success-indicator.js';

describe('parseIndicator', () => {
  it('parses exact url path matching', () => {
    expect(parseIndicator('url:/dashboard')).toMatchObject({
      type: 'url',
      value: '/dashboard',
      match: 'exact',
    });
  });

  it('parses explicit prefix matching', () => {
    expect(parseIndicator('url-prefix:/manage')).toMatchObject({
      type: 'url',
      value: '/manage',
      match: 'prefix',
    });
  });

  it('parses selector indicator', () => {
    expect(parseIndicator('selector:#welcome-banner')).toMatchObject({
      type: 'selector',
      value: '#welcome-banner',
    });
  });

  it('parses text indicator', () => {
    expect(parseIndicator('text:Welcome back')).toMatchObject({
      type: 'text',
      value: 'Welcome back',
    });
  });

  it('throws for missing colon separator', () => {
    expect(() => parseIndicator('just-a-string')).toThrow('Invalid successIndicator format');
  });

  it('throws for unknown indicator type', () => {
    expect(() => parseIndicator('cookie:session_id')).toThrow('Unknown successIndicator type');
  });

  it('throws for empty value after colon', () => {
    expect(() => parseIndicator('url:')).toThrow('Empty value');
  });
});

describe('matchesUrlIndicator', () => {
  it('does not treat /login as a match for url:/', () => {
    expect(
      matchesUrlIndicator('https://example.com/login', {
        type: 'url',
        value: '/',
        match: 'exact',
      })
    ).toBe(false);
  });

  it('does not treat callback routes as a match for url:/', () => {
    expect(
      matchesUrlIndicator('https://example.com/api/auth/callback/microsoft', {
        type: 'url',
        value: '/',
        match: 'exact',
      })
    ).toBe(false);
  });

  it('matches exact paths exactly', () => {
    expect(
      matchesUrlIndicator('https://example.com/dashboard', {
        type: 'url',
        value: '/dashboard',
        match: 'exact',
      })
    ).toBe(true);
  });

  it('matches prefixes only when explicitly requested', () => {
    expect(
      matchesUrlIndicator('https://example.com/manage/knowledge-bases', {
        type: 'url',
        value: '/manage',
        match: 'prefix',
      })
    ).toBe(true);
  });

  it('returns false for non-url indicator types', () => {
    expect(
      matchesUrlIndicator('https://example.com/', {
        type: 'selector',
        value: '#banner',
      })
    ).toBe(false);
  });

  it('falls back to string comparison for invalid URLs with exact match', () => {
    expect(
      matchesUrlIndicator('not-a-url', {
        type: 'url',
        value: 'not-a-url',
        match: 'exact',
      })
    ).toBe(true);
  });

  it('falls back to string includes for invalid URLs with prefix match', () => {
    expect(
      matchesUrlIndicator('not-a-url/path', {
        type: 'url',
        value: 'not-a-url',
        match: 'prefix',
      })
    ).toBe(true);
  });

  it('returns false for non-matching invalid URL with exact match', () => {
    expect(
      matchesUrlIndicator('not-a-url', {
        type: 'url',
        value: 'different',
        match: 'exact',
      })
    ).toBe(false);
  });
});
