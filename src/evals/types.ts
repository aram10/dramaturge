// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

export interface EvalCaseResult {
  id: string;
  passed: boolean;
  tags: string[];
  failureReason?: string;
}

export interface EvalFailureSummary {
  id: string;
  reason: string;
}

export interface EvalTagBreakdown {
  total: number;
  passed: number;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  failures: EvalFailureSummary[];
  tagBreakdown: Record<string, EvalTagBreakdown>;
}
