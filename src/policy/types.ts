// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

export interface ExpectedResponseRule {
  method?: string;
  pathPrefix: string;
  statuses: number[];
}

export interface PolicyConfig {
  expectedResponses: ExpectedResponseRule[];
  ignoredConsolePatterns: string[];
}
