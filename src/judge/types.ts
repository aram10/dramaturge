// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { JudgeConfig as RuntimeJudgeConfig } from '../config.js';
import type {
  Evidence,
  FindingCategory,
  FindingConfidence,
  FindingSeverity,
  FindingVerdict,
  ReplayableAction,
} from '../types.js';

export interface Observation {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  evidenceIds: string[];
  route?: string;
  objective: string;
  breadcrumbs: string[];
  actionIds: string[];
  verdictHint?: Partial<FindingVerdict>;
}

export interface TraceBundle {
  id: string;
  observationId: string;
  evidenceIds: string[];
  actionIds: string[];
  summary: string[];
}

export interface JudgeDecision {
  hypothesis: string;
  observation: string;
  alternativesConsidered: string[];
  suggestedVerification: string[];
  confidence?: FindingConfidence;
  /**
   * The judge's disposition for the observation (#206). `rejected` findings are
   * quarantined (dropped from reports unless `judge.dropRejected` is false);
   * `uncertain` ships with reduced confidence; `confirmed` ships normally.
   */
  disposition?: 'confirmed' | 'rejected' | 'uncertain';
}

export interface JudgeWorkerObservationsInput {
  observations: Observation[];
  evidence: Evidence[];
  actions: ReplayableAction[];
  config?: RuntimeJudgeConfig;
  judgeText?: (prompt: string, timeoutMs: number) => Promise<JudgeDecision>;
}
