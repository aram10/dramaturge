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
