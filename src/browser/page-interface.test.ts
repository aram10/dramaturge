// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, vi } from 'vitest';
import { hasRequestContext } from './page-interface.js';

describe('hasRequestContext', () => {
  it('returns true when request.fetch is a function', () => {
    expect(
      hasRequestContext({
        request: {
          fetch: vi.fn(),
        },
      })
    ).toBe(true);
  });

  it('returns false when request.fetch exists but is not callable', () => {
    expect(
      hasRequestContext({
        request: {
          fetch: 'not-a-function',
        },
      })
    ).toBe(false);
  });
});
