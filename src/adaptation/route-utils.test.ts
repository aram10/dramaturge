// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { isCallbackRoute, isLoginRoute, trimTrailingSlashes } from './route-utils.js';

describe('route utilities', () => {
  it('trims trailing slashes without regex backtracking', () => {
    expect(trimTrailingSlashes('/dashboard///')).toBe('/dashboard');
    expect(trimTrailingSlashes('///')).toBe('');
    expect(trimTrailingSlashes('/')).toBe('');
  });

  it('detects auth route segments without regex backtracking', () => {
    expect(isLoginRoute('/signin?from=/dashboard')).toBe(true);
    expect(isLoginRoute('/users/sign-in/settings')).toBe(true);
    expect(isLoginRoute('/signed-out')).toBe(false);

    expect(isCallbackRoute('/oauth/callback')).toBe(true);
    expect(isCallbackRoute('/auth/sso/complete')).toBe(true);
    expect(isCallbackRoute('/callbacks')).toBe(false);
  });
});
