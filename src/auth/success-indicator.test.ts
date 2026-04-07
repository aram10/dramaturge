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
});
