import { describe, it, expect } from 'vitest';
import { listConcurrencyScenarios } from './concurrency.js';

describe('listConcurrencyScenarios', () => {
  it('returns empty when includeConcurrencyProbes is false', () => {
    const result = listConcurrencyScenarios({
      destructiveActionsAllowed: true,
      includeConcurrencyProbes: false,
    });

    expect(result).toEqual([]);
  });

  it('returns empty when destructiveActionsAllowed is false', () => {
    const result = listConcurrencyScenarios({
      destructiveActionsAllowed: false,
      includeConcurrencyProbes: true,
    });

    expect(result).toEqual([]);
  });

  it('returns scenario when both flags are true', () => {
    const result = listConcurrencyScenarios({
      destructiveActionsAllowed: true,
      includeConcurrencyProbes: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('parallel-submit-race');
    expect(result[0].title).toBe('Parallel submit race');
    expect(result[0].requiresMutation).toBe(true);
  });

  it('returns empty when both flags are false', () => {
    const result = listConcurrencyScenarios({
      destructiveActionsAllowed: false,
      includeConcurrencyProbes: false,
    });

    expect(result).toEqual([]);
  });
});
