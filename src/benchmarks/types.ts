// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Finding, FindingCategory } from '../types.js';

export interface BenchmarkApp {
  id: string;
  name: string;
  url: string;
  description: string;
  framework?: string;
  configPath: string;
  knownIssues?: KnownIssue[];
}

export interface KnownIssue {
  id: string;
  category: FindingCategory;
  description: string;
  route?: string;
  severity: 'Critical' | 'Major' | 'Minor' | 'Trivial';
}

export interface BenchmarkMetrics {
  appId: string;
  totalFindings: number;
  truePositives: number;
  falsePositives: number;
  knownIssuesCaught: number;
  knownIssuesMissed: number;
  precision: number;
  recall: number;
  categoriesFound: Partial<Record<FindingCategory, number>>;
  timeToFirstFinding: number;
  totalRuntime: number;
  timestamp: string;
}

export interface FindingClassification {
  finding: Finding;
  isRealIssue: boolean;
  matchesKnownIssue: boolean;
  knownIssueId?: string;
  falsePositiveReason?: string;
  notes?: string;
}

export interface BenchmarkResult {
  app: BenchmarkApp;
  metrics: BenchmarkMetrics;
  classifications: FindingClassification[];
  rawFindings: Finding[];
}
