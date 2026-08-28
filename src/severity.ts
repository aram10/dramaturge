// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { FindingSeverity } from './types.js';

export const FAILURE_SEVERITIES = ['critical', 'major', 'minor', 'trivial', 'none'] as const;

export type FailureSeverity = (typeof FAILURE_SEVERITIES)[number];

export const FINDING_SEVERITIES: FindingSeverity[] = ['Critical', 'Major', 'Minor', 'Trivial'];

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  Critical: 0,
  Major: 1,
  Minor: 2,
  Trivial: 3,
};

export function toFindingSeverity(value: Exclude<FailureSeverity, 'none'>): FindingSeverity {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}` as FindingSeverity;
}

export function meetsSeverityThreshold(
  severity: FindingSeverity,
  threshold: FailureSeverity
): boolean {
  if (threshold === 'none') return false;
  return SEVERITY_RANK[severity] <= SEVERITY_RANK[toFindingSeverity(threshold)];
}

export function emptySeverityCounts(): Record<FindingSeverity, number> {
  return {
    Critical: 0,
    Major: 0,
    Minor: 0,
    Trivial: 0,
  };
}
