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
  /**
   * Returns the base URL for the provider, or `undefined` when the URL has
   * not been configured. The factory throws a descriptive error at
   * request-build time if the URL is missing.
   */
  getBaseUrl: () => string | undefined;
  buildAuthHeaders: (apiKey: string) => Record<string, string>;
  /** If true, include the model name in the request body (default: true). */
  includeModelInBody?: boolean;
  /**
   * If false, the adapter may build requests even when `getApiKey()` returns
   * undefined. Used for local backends such as Ollama where authentication is
   * optional. When the key is absent, no auth headers are attached.
   * Defaults to true (API key required).
   */
  requiresApiKey?: boolean;
  /**
   * Override the default `isConfigured()` behaviour. The default checks only
   * for API key presence; providers whose configuration is signalled by a
   * base-URL env var (e.g. Ollama) can supply a custom predicate here.
   */
  isConfigured?: () => boolean;
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
  const requiresApiKey = config.requiresApiKey !== false;

  function resolveAuthHeaders(requestKind: 'models' | 'vision models'): Record<string, string> {
    const key = config.getApiKey();
    if (!key) {
      if (requiresApiKey) {
        throw new Error(
          `${config.envKeys[0]} not set — required for ${config.name} ${requestKind}`
        );
      }
      return {};
    }
    return config.buildAuthHeaders(key);
  }

  function resolveBaseUrl(): string {
    const baseUrl = config.getBaseUrl();
    if (!baseUrl) {
      throw new Error(
        `${config.name} base URL not set — set ${config.envKeys[0]} to the endpoint URL`
      );
    }
    return baseUrl;
  }

  return {
    name: config.name,
    prefix: config.prefix,
    envKeys: config.envKeys,

    isConfigured(): boolean {
      if (config.isConfigured) {
        return config.isConfigured();
      }
      return !!config.getApiKey();
    },

    buildChatRequest(options: {
      model: string;
      system: string;
      messages: ChatMessage[];
      maxTokens: number;
    }): ProviderRequest {
      const authHeaders = resolveAuthHeaders('models');
      const baseUrl = resolveBaseUrl();

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
        url: `${baseUrl}/chat/completions`,
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
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
      const authHeaders = resolveAuthHeaders('vision models');
      const baseUrl = resolveBaseUrl();

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
        url: `${baseUrl}/chat/completions`,
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
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
