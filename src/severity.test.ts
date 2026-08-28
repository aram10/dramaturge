// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { emptySeverityCounts, meetsSeverityThreshold, toFindingSeverity } from './severity.js';

describe('severity helpers', () => {
  it('normalizes CLI thresholds to finding severities', () => {
    expect(toFindingSeverity('critical')).toBe('Critical');
    expect(toFindingSeverity('trivial')).toBe('Trivial');
  });

  it('matches findings at or above a threshold', () => {
    expect(meetsSeverityThreshold('Critical', 'major')).toBe(true);
    expect(meetsSeverityThreshold('Major', 'major')).toBe(true);
    expect(meetsSeverityThreshold('Minor', 'major')).toBe(false);
    expect(meetsSeverityThreshold('Critical', 'none')).toBe(false);
  });

  it('creates independent zeroed severity counts', () => {
    const counts = emptySeverityCounts();
    counts.Critical++;
    expect(emptySeverityCounts().Critical).toBe(0);
  });
});
