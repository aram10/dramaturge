// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { FindingReplayManifest } from './manifest.js';
import type { CurrentOracleObservation } from './replayer.js';

export interface OracleMatchSummary {
  originalCount: number;
  matchedOriginalCount: number;
  currentCount: number;
  allOriginalMatched: boolean;
  hasCurrentFailures: boolean;
  hasUnexpectedCurrentFailures: boolean;
  matchRatio: number;
}

export function compareReplayOracles(
  manifest: FindingReplayManifest,
  observed: CurrentOracleObservation
): OracleMatchSummary {
  const consoleMatchCount = (manifest.oracles.consoleErrorFragments ?? []).filter((fragment) =>
    observed.consoleErrors.some((message) => message.includes(fragment))
  ).length;
  const networkMatchCount = (manifest.oracles.networkFailures ?? []).filter((failure) =>
    observed.networkFailures.some(
      (item) => item.status === failure.status && item.url.includes(failure.urlPattern)
    )
  ).length;
  const a11yMatchCount = (manifest.oracles.a11yRuleIds ?? []).filter((ruleId) =>
    observed.a11yRuleIds.includes(ruleId)
  ).length;
  const originalCount =
    (manifest.oracles.consoleErrorFragments?.length ?? 0) +
    (manifest.oracles.networkFailures?.length ?? 0) +
    (manifest.oracles.a11yRuleIds?.length ?? 0);
  const matchedOriginalCount = consoleMatchCount + networkMatchCount + a11yMatchCount;
  const currentCount =
    observed.consoleErrors.length + observed.networkFailures.length + observed.a11yRuleIds.length;

  return {
    originalCount,
    matchedOriginalCount,
    currentCount,
    allOriginalMatched: originalCount > 0 && matchedOriginalCount === originalCount,
    hasCurrentFailures: currentCount > 0,
    hasUnexpectedCurrentFailures: currentCount > matchedOriginalCount,
    matchRatio: originalCount > 0 ? matchedOriginalCount / originalCount : 0,
  };
}
