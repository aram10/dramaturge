// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

// --- Public types ---
export type { ChatMessage, ProviderId, LLMProviderAdapter, ProviderRequest } from './types.js';

// --- Registry ---
export {
  resolveProvider,
  stripProviderPrefix,
  hasConfiguredProvider,
  detectProviderFromEnv,
  allProviders,
} from './registry.js';

// --- Client ---
export { sendChatCompletion, sendVisionCompletion, redactApiKey } from './client.js';

// --- Provider adapters (for direct access / testing) ---
export {
  anthropicProvider,
  openaiProvider,
  createOpenAICompatibleProvider,
  googleProvider,
  azureFoundryProvider,
  openRouterProvider,
  githubModelsProvider,
} from './providers/index.js';
