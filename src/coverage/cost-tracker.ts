// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * LLM cost tracking module.
 *
 * Inspired by ECC's cost-aware-llm-pipeline skill. Provides immutable
 * cost record tracking, budget enforcement, and model routing by
 * task complexity.
 *
 * Pricing data is approximate and based on 2025-2026 published rates.
 * The tracker is intentionally simple and does not depend on external services.
 */

export interface CostRecord {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly timestamp: string;
  readonly label: string;
}

export interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  byModel: Record<string, { costUsd: number; calls: number }>;
  overBudget: boolean;
}

/** Per-million-token pricing for known models. */
interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-haiku-4-5": { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  "claude-sonnet-4-6": { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  "claude-sonnet-4-20250514": { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  "claude-opus-4-5": { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  // OpenAI
  "gpt-4o": { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "gpt-4.1": { inputPerMillion: 2.00, outputPerMillion: 8.00 },
  "gpt-4.1-mini": { inputPerMillion: 0.40, outputPerMillion: 1.60 },
  // Google
  "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10.00 },
};

/** Fallback pricing when model is unknown. Uses mid-range estimate. */
const FALLBACK_PRICING: ModelPricing = {
  inputPerMillion: 3.00,
  outputPerMillion: 15.00,
};

function stripProviderPrefix(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function lookupPricing(model: string): ModelPricing {
  const modelId = stripProviderPrefix(model).toLowerCase();

  // Exact match
  if (MODEL_PRICING[modelId]) {
    return MODEL_PRICING[modelId];
  }

  // Prefix match for versioned model names
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(key) || key.startsWith(modelId)) {
      return pricing;
    }
  }

  return FALLBACK_PRICING;
}

/** Estimate cost in USD for a single LLM call. */
export function estimateCallCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = lookupPricing(model);
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/**
 * Approximate token count from a string.
 *
 * Uses a simple heuristic: ~4 characters per token for English text.
 * This avoids pulling in a full tokenizer dependency.
 */
export function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export class CostTracker {
  private readonly records: CostRecord[] = [];
  private readonly budgetLimitUsd: number;

  constructor(budgetLimitUsd = Infinity) {
    this.budgetLimitUsd = budgetLimitUsd;
  }

  /** Record a completed LLM call. Returns the cost record. */
  record(
    model: string,
    inputTokens: number,
    outputTokens: number,
    label: string
  ): CostRecord {
    const costUsd = estimateCallCost(model, inputTokens, outputTokens);
    const entry: CostRecord = {
      model: stripProviderPrefix(model),
      inputTokens,
      outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
      label,
    };
    this.records.push(entry);
    return entry;
  }

  /** Check whether the budget has been exceeded. */
  get overBudget(): boolean {
    return this.totalCostUsd > this.budgetLimitUsd;
  }

  /** Total cost in USD across all recorded calls. */
  get totalCostUsd(): number {
    return this.records.reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Get a summary of all tracked costs. */
  getSummary(): CostSummary {
    const byModel: Record<string, { costUsd: number; calls: number }> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const record of this.records) {
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;

      const existing = byModel[record.model];
      if (existing) {
        existing.costUsd += record.costUsd;
        existing.calls += 1;
      } else {
        byModel[record.model] = { costUsd: record.costUsd, calls: 1 };
      }
    }

    return {
      totalCostUsd: this.totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      callCount: this.records.length,
      byModel,
      overBudget: this.overBudget,
    };
  }

  /** Get all recorded cost entries. */
  getRecords(): readonly CostRecord[] {
    return this.records;
  }
}
