// SPDX-License-Identifier: Apache-2.0
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

/**
 * Opt-in flag for GitHub Models auto-detection. GITHUB_TOKEN is present in every
 * GitHub Actions job and rarely carries `models:read` scope, so we only treat
 * GitHub Models as a configured provider when the user explicitly opts in by
 * setting DRAMATURGE_GITHUB_MODELS to a truthy value (#204).
 */
function githubModelsOptedIn(): boolean {
  const flag = process.env.DRAMATURGE_GITHUB_MODELS?.trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
}

export const githubModelsProvider = createOpenAICompatibleProvider({
  name: 'GitHub Models',
  prefix: 'github',
  envKeys: ['GITHUB_TOKEN'],
  getApiKey: () => process.env.GITHUB_TOKEN,
  getBaseUrl: () => 'https://models.github.ai/inference',
  isConfigured: () => Boolean(process.env.GITHUB_TOKEN) && githubModelsOptedIn(),
  useMaxCompletionTokensForNewModels: true,
  buildAuthHeaders: (key) => ({ authorization: `Bearer ${key}` }),
});
