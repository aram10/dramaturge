import { describe, expect, it } from 'vitest';
import { listAdversarialScenarios } from './scenarios.js';

describe('listAdversarialScenarios', () => {
  it('keeps the default safe set read-only when destructive actions are disabled', () => {
    const scenarios = listAdversarialScenarios(
      {
        enabled: true,
        maxSequencesPerNode: 3,
        safeMode: true,
        includeAuthzProbes: false,
        includeConcurrencyProbes: false,
      },
      false
    );

    expect(scenarios.map((scenario) => scenario.id)).toContain('stale-detail-view');
    expect(scenarios.map((scenario) => scenario.id)).toContain('back-button-state-mismatch');
    expect(scenarios.map((scenario) => scenario.id)).not.toContain('double-submit');
    expect(scenarios.map((scenario) => scenario.id)).not.toContain('authz-route-swap');
    expect(scenarios.map((scenario) => scenario.id)).not.toContain('parallel-submit-race');
  });

  it('unlocks authz and concurrency scenarios only when explicitly enabled', () => {
    const scenarios = listAdversarialScenarios(
      {
        enabled: true,
        maxSequencesPerNode: 3,
        safeMode: false,
        includeAuthzProbes: true,
        includeConcurrencyProbes: true,
      },
      true
    );

    expect(scenarios.map((scenario) => scenario.id)).toContain('double-submit');
    expect(scenarios.map((scenario) => scenario.id)).toContain('authz-route-swap');
    expect(scenarios.map((scenario) => scenario.id)).toContain('parallel-submit-race');
  });
});
