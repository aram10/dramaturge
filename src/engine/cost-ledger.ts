// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { appendToLedger, mergeLedgerEntries, type LedgerContext } from '../ledger.js';
import type { EngineContext } from './context.js';

export function appendNewCostRecords(ctx: EngineContext, context: LedgerContext): void {
  const allCostRecords = ctx.costTracker?.getRecords() ?? [];
  const newCostRecords = allCostRecords.slice(ctx.costLedgerCursor);
  if (newCostRecords.length === 0) {
    return;
  }
  ctx.costLedgerCursor = allCostRecords.length;
  ctx.runLedger = appendToLedger(
    ctx.runLedger,
    mergeLedgerEntries({
      actionRecorderActions: [],
      evidence: [],
      findings: [],
      costRecords: newCostRecords,
      context,
    })
  );
}
