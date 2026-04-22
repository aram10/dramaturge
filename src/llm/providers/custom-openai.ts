// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Generic OpenAI-compatible inference adapter.
 *
 * Endpoint: POST ${OPENAI_COMPATIBLE_BASE_URL}/chat/completions
 *
 * For any service that speaks the OpenAI chat-completions protocol but is not
 * one of the first-class adapters (OpenAI, Azure, OpenRouter, GitHub Models,
 * Ollama). Covers self-hosted llama.cpp/vLLM/TGI/LocalAI deployments, corporate
 * gateways, and third-party inference providers.
 *
 * Model strings use the `custom/` prefix. The remainder of the string is the
 * model identifier forwarded to the backend, e.g. `custom/llama-3-70b`.
 *
 * Environment variables:
 *   OPENAI_COMPATIBLE_BASE_URL — endpoint URL (required). Presence marks the
 *                                provider as configured.
 *   OPENAI_COMPATIBLE_API_KEY  — optional bearer token; omitted from headers
 *                                when unset (e.g. for keyless self-hosted
 *                                servers).
 */

import { createOpenAICompatibleProvider } from './openai-compatible.js';

export const customOpenAICompatibleProvider = createOpenAICompatibleProvider({
  name: 'OpenAI-compatible',
  prefix: 'custom',
  envKeys: ['OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_API_KEY'],
  getApiKey: () => process.env.OPENAI_COMPATIBLE_API_KEY,
  getBaseUrl: () => process.env.OPENAI_COMPATIBLE_BASE_URL,
  buildAuthHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  requiresApiKey: false,
  isConfigured: () => Boolean(process.env.OPENAI_COMPATIBLE_BASE_URL),
});
