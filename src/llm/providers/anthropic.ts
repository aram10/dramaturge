// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { LLMProviderAdapter, ChatMessage, ProviderRequest } from '../types.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ENV_KEY = 'ANTHROPIC_API_KEY';

function apiKey(): string | undefined {
  return process.env[ENV_KEY];
}

function headers(key: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
}

function extractText(data: unknown): string {
  return (
    (data as { content?: Array<{ type: string; text: string }> }).content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('') ?? ''
  );
}

export const anthropicProvider: LLMProviderAdapter = {
  name: 'Anthropic',
  prefix: 'anthropic',
  envKeys: [ENV_KEY],

  isConfigured(): boolean {
    return !!apiKey();
  },

  buildChatRequest(options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    maxTokens: number;
  }): ProviderRequest {
    const key = apiKey();
    if (!key) throw new Error(`${ENV_KEY} not set — required for Anthropic models`);
    return {
      url: API_URL,
      headers: headers(key),
      body: {
        model: options.model,
        max_tokens: options.maxTokens,
        system: options.system,
        messages: options.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
      },
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
    const key = apiKey();
    if (!key) throw new Error(`${ENV_KEY} not set — required for Anthropic vision models`);
    return {
      url: API_URL,
      headers: headers(key),
      body: {
        model: options.model,
        max_tokens: options.maxTokens,
        system: options.system,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: options.base64Image },
              },
              { type: 'text', text: options.pageContext },
            ],
          },
        ],
      },
    };
  },

  extractVisionResponse: extractText,
};
