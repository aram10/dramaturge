// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Ollama inference adapter.
 *
 * Endpoint: POST ${OLLAMA_BASE_URL}/chat/completions
 *
 * Ollama exposes an OpenAI-compatible `/v1/chat/completions` API. A running
 * Ollama server typically requires no authentication; when it does (reverse
 * proxy, cloud deployment), users can set `OLLAMA_API_KEY`.
 *
 * Users opt in by setting `OLLAMA_BASE_URL` (even to the default URL). This
 * avoids auto-selecting Ollama when a user has simply installed it locally
 * but not wired it up as their inference backend.
 *
 * Model strings use the `ollama/` prefix, e.g. `ollama/llama3`, `ollama/mistral`.
 *
 * Environment variables:
 *   OLLAMA_BASE_URL — endpoint URL (required). Set this explicitly, even to
 *                     http://localhost:11434/v1, to opt in.
 *   OLLAMA_API_KEY  — optional bearer token if the server requires auth.
 */

import { createOpenAICompatibleProvider } from './openai-compatible.js';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

export const ollamaProvider = createOpenAICompatibleProvider({
  name: 'Ollama',
  prefix: 'ollama',
  envKeys: ['OLLAMA_BASE_URL', 'OLLAMA_API_KEY'],
  getApiKey: () => process.env.OLLAMA_API_KEY,
  getBaseUrl: () => process.env.OLLAMA_BASE_URL,
  buildAuthHeaders: (key) => ({ authorization: `Bearer ${key}` }),
  requiresApiKey: false,
  isConfigured: () => Boolean(process.env.OLLAMA_BASE_URL?.trim()),
});
