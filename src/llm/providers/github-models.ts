// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * GitHub Models inference adapter.
 *
 * Endpoint: POST https://models.github.ai/inference/chat/completions
 *
 * Authentication:
 *   Authorization: Bearer <GITHUB_TOKEN>
 *
 * Request/response shape is OpenAI-compatible.
 * The model name in the body uses GitHub's naming convention
 * (e.g. "openai/gpt-4.1", "meta/llama-4-scout").
 *
 * Required environment variables:
 *   GITHUB_TOKEN — A fine-grained personal access token with `models:read` scope
 */

import { createOpenAICompatibleProvider } from './openai-compatible.js';

export const githubModelsProvider = createOpenAICompatibleProvider({
  name: 'GitHub Models',
  prefix: 'github',
  envKeys: ['GITHUB_TOKEN'],
  getApiKey: () => process.env.GITHUB_TOKEN,
  getBaseUrl: () => 'https://models.github.ai/inference',
  buildAuthHeaders: (key) => ({ authorization: `Bearer ${key}` }),
});
