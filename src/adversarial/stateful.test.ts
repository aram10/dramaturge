import { describe, it, expect } from 'vitest';
import { listStatefulScenarios } from './stateful.js';
import type { AdversarialScenario } from './stateful.js';

describe('listStatefulScenarios', () => {
  it('returns only non-mutation scenarios when destructiveActionsAllowed is false', () => {
    const result = listStatefulScenarios({
      destructiveActionsAllowed: false,
      includeAuthzProbes: false,
    });

    expect(result).toHaveLength(2);
    const ids = result.map((s: AdversarialScenario) => s.id);
    expect(ids).toContain('stale-detail-view');
    expect(ids).toContain('back-button-state-mismatch');
    expect(result.every((s: AdversarialScenario) => !s.requiresMutation)).toBe(true);
  });

  it('returns all 4 base scenarios when destructiveActionsAllowed is true', () => {
    const result = listStatefulScenarios({
      destructiveActionsAllowed: true,
      includeAuthzProbes: false,
    });

    expect(result).toHaveLength(4);
    const ids = result.map((s: AdversarialScenario) => s.id);
    expect(ids).toContain('stale-detail-view');
    expect(ids).toContain('back-button-state-mismatch');
    expect(ids).toContain('double-submit');
    expect(ids).toContain('back-button-resubmission');
  });

  it('appends authz-route-swap when includeAuthzProbes is true', () => {
    const result = listStatefulScenarios({
      destructiveActionsAllowed: false,
      includeAuthzProbes: true,
    });

    const ids = result.map((s: AdversarialScenario) => s.id);
    expect(ids).toContain('authz-route-swap');
    // 2 non-mutation base + authz-route-swap = 3
    expect(result).toHaveLength(3);
  });

  it('returns all 5 scenarios when both flags are true', () => {
    const result = listStatefulScenarios({
      destructiveActionsAllowed: true,
      includeAuthzProbes: true,
    });

    expect(result).toHaveLength(5);
    const ids = result.map((s: AdversarialScenario) => s.id);
    expect(ids).toContain('stale-detail-view');
    expect(ids).toContain('back-button-state-mismatch');
    expect(ids).toContain('double-submit');
    expect(ids).toContain('back-button-resubmission');
    expect(ids).toContain('authz-route-swap');
  });
});
