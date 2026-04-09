// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { buildStabilityChecker } from './page-stability.js';

describe('buildStabilityChecker', () => {
  it('returns a page.evaluate-compatible function string', () => {
    const checker = buildStabilityChecker();
    expect(typeof checker).toBe('string');
    expect(checker).toContain('MutationObserver');
  });

  it('contains timeout fallback', () => {
    const checker = buildStabilityChecker();
    expect(checker).toContain('timeout');
  });

  it('contains quiet period logic', () => {
    const checker = buildStabilityChecker();
    expect(checker).toContain('QUIET_MS');
  });
});
