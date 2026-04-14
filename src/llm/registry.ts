// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { LLMProviderAdapter, ProviderId } from './types.js';
import {
  anthropicProvider,
  openaiProvider,
  googleProvider,
  azureFoundryProvider,
  openRouterProvider,
  githubModelsProvider,
} from './providers/index.js';

/**
 * All built-in provider adapters, keyed by their prefix.
 *
 * Order matters only for `detectProviderFromEnv` — first match wins.
 */
const PROVIDERS: Map<ProviderId, LLMProviderAdapter> = new Map([
  ['anthropic', anthropicProvider],
  ['openai', openaiProvider],
  ['google', googleProvider],
  ['azure', azureFoundryProvider],
  ['openrouter', openRouterProvider],
  ['github', githubModelsProvider],
]);

/**
 * Resolve a provider adapter from a model string.
 *
 * Model strings use the format `<prefix>/<model-id>`, e.g. `openai/gpt-4.1`.
 * If no recognised prefix is found the default provider (`anthropic`) is returned.
 */
export function resolveProvider(model: string): LLMProviderAdapter {
  const prefix = detectPrefix(model);
  return PROVIDERS.get(prefix) ?? anthropicProvider;
}

/**
 * Extract the model ID portion from a prefixed model string.
 *
 * `"openai/gpt-4.1"` → `"gpt-4.1"`
 * `"claude-haiku-4-5"` → `"claude-haiku-4-5"`
 */
export function stripProviderPrefix(model: string): string {
  const slash = model.indexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/**
 * Detect the prefix (provider id) from a model string.
 */
function detectPrefix(model: string): ProviderId {
  const lower = model.toLowerCase();
  for (const key of PROVIDERS.keys()) {
    if (lower.startsWith(`${key}/`)) return key;
  }
  return 'anthropic';
}

/**
 * Check whether **any** provider has its required API key(s) configured,
 * or — if a specific model is given — whether that model's provider is ready.
 */
export function hasConfiguredProvider(model?: string): boolean {
  if (!model) {
    for (const adapter of PROVIDERS.values()) {
      if (adapter.isConfigured()) return true;
    }
    return false;
  }
  return resolveProvider(model).isConfigured();
}

/**
 * Detect a configured provider from environment variables (first match wins).
 *
 * Preference order follows the Map insertion order:
 * Anthropic → OpenAI → Google → Azure → OpenRouter → GitHub
 */
export function detectProviderFromEnv(): ProviderId {
  for (const [id, adapter] of PROVIDERS) {
    if (adapter.isConfigured()) return id;
  }
  return 'anthropic';
}

/**
 * Return all registered providers (for doctor/diagnostic commands).
 */
export function allProviders(): ReadonlyMap<ProviderId, LLMProviderAdapter> {
  return PROVIDERS;
}
