// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * OpenRouter inference adapter.
 *
 * Endpoint: POST https://openrouter.ai/api/v1/chat/completions
 *
 * Authentication:
 *   Authorization: Bearer <OPENROUTER_API_KEY>
 *
 * Request/response shape is fully OpenAI-compatible.
 * The model name in the body uses OpenRouter's naming convention
 * (e.g. "anthropic/claude-3.5-sonnet", "openai/gpt-4o").
 *
 * Required environment variables:
 *   OPENROUTER_API_KEY — API key from https://openrouter.ai/keys
 */

import { createOpenAICompatibleProvider } from './openai-compatible.js';

export const openRouterProvider = createOpenAICompatibleProvider({
  name: 'OpenRouter',
  prefix: 'openrouter',
  envKeys: ['OPENROUTER_API_KEY'],
  getApiKey: () => process.env.OPENROUTER_API_KEY,
  getBaseUrl: () => 'https://openrouter.ai/api/v1',
  buildAuthHeaders: (key) => ({ authorization: `Bearer ${key}` }),
});
