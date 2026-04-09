// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { listSecurityScenarios } from './security.js';

describe('listSecurityScenarios', () => {
  it('returns non-mutation scenarios when destructive actions are disabled', () => {
    const scenarios = listSecurityScenarios({ destructiveActionsAllowed: false });
    const ids = scenarios.map((s) => s.id);

    expect(ids).toContain('xss-input-reflection');
    expect(ids).toContain('open-redirect');
    expect(ids).not.toContain('csrf-token-absence');
    expect(ids).not.toContain('missing-rate-limit');
  });

  it('includes mutation scenarios when destructive actions are allowed', () => {
    const scenarios = listSecurityScenarios({ destructiveActionsAllowed: true });
    const ids = scenarios.map((s) => s.id);

    expect(ids).toContain('csrf-token-absence');
    expect(ids).toContain('xss-input-reflection');
    expect(ids).toContain('missing-rate-limit');
    expect(ids).toContain('open-redirect');
    expect(scenarios.length).toBe(4);
  });

  it('every scenario has required fields', () => {
    const scenarios = listSecurityScenarios({ destructiveActionsAllowed: true });
    for (const scenario of scenarios) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.title).toBeTruthy();
      expect(scenario.description).toBeTruthy();
    }
  });
});
