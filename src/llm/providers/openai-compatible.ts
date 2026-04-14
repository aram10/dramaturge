// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { LLMProviderAdapter, ChatMessage, ProviderId, ProviderRequest } from '../types.js';

/**
 * Configuration for creating an OpenAI-compatible provider adapter.
 *
 * Many inference services (OpenAI, Azure Foundry, OpenRouter, GitHub Models)
 * share the same request/response shape. This factory captures the
 * differences (URL, auth headers, env vars) so each concrete adapter is
 * a thin configuration layer on top of shared logic.
 */
export interface OpenAICompatibleConfig {
  name: string;
  prefix: ProviderId;
  envKeys: string[];
  getApiKey: () => string | undefined;
  getBaseUrl: () => string;
  buildAuthHeaders: (apiKey: string) => Record<string, string>;
  /** If true, include the model name in the request body (default: true). */
  includeModelInBody?: boolean;
}

function extractText(data: unknown): string {
  return (
    (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message
      ?.content ?? ''
  );
}

/**
 * Create an LLMProviderAdapter for an OpenAI-compatible API.
 */
export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProviderAdapter {
  const includeModel = config.includeModelInBody !== false;

  return {
    name: config.name,
    prefix: config.prefix,
    envKeys: config.envKeys,

    isConfigured(): boolean {
      return !!config.getApiKey();
    },

    buildChatRequest(options: {
      model: string;
      system: string;
      messages: ChatMessage[];
      maxTokens: number;
    }): ProviderRequest {
      const key = config.getApiKey();
      if (!key) {
        throw new Error(`${config.envKeys[0]} not set — required for ${config.name} models`);
      }

      const body: Record<string, unknown> = {
        max_tokens: options.maxTokens,
        messages: [
          { role: 'system', content: options.system },
          ...options.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      };
      if (includeModel) {
        body.model = options.model;
      }

      return {
        url: `${config.getBaseUrl()}/chat/completions`,
        headers: {
          'content-type': 'application/json',
          ...config.buildAuthHeaders(key),
        },
        body,
      };
    },

    extractChatResponse: extractText,

    buildVisionRequest(options: {
      model: string;
      system: string;
      base64Image: string;
      pageContext: string;
      maxTokens: number;
    }): ProviderRequest {
      const key = config.getApiKey();
      if (!key) {
        throw new Error(`${config.envKeys[0]} not set — required for ${config.name} vision models`);
      }

      const body: Record<string, unknown> = {
        max_tokens: options.maxTokens,
        messages: [
          { role: 'system', content: options.system },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${options.base64Image}` },
              },
              { type: 'text', text: options.pageContext },
            ],
          },
        ],
      };
      if (includeModel) {
        body.model = options.model;
      }

      return {
        url: `${config.getBaseUrl()}/chat/completions`,
        headers: {
          'content-type': 'application/json',
          ...config.buildAuthHeaders(key),
        },
        body,
      };
    },

    extractVisionResponse: extractText,
  };
}

/**
 * Standard OpenAI provider — the canonical OpenAI API endpoint.
 */
export const openaiProvider: LLMProviderAdapter = createOpenAICompatibleProvider({
  name: 'OpenAI',
  prefix: 'openai',
  envKeys: ['OPENAI_API_KEY'],
  getApiKey: () => process.env.OPENAI_API_KEY,
  getBaseUrl: () => process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  buildAuthHeaders: (key) => ({ authorization: `Bearer ${key}` }),
});
