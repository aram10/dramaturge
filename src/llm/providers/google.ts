// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { LLMProviderAdapter, ChatMessage, LlmUsage, ProviderRequest } from '../types.js';

const ENV_KEY = 'GOOGLE_GENERATIVE_AI_API_KEY';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function apiKey(): string | undefined {
  return process.env[ENV_KEY];
}

function url(model: string): string {
  return `${BASE}/${model}:generateContent`;
}

function headers(key: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': key };
}

function extractText(data: unknown): string {
  return (
    (
      data as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
    ).candidates?.[0]?.content?.parts
      ?.filter((p) => p.text)
      .map((p) => p.text)
      .join('') ?? ''
  );
}

function extractUsage(data: unknown): LlmUsage | null {
  const usage = (
    data as {
      usageMetadata?: {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        thoughtsTokenCount?: unknown;
      };
    }
  ).usageMetadata;
  if (!usage) {
    return null;
  }

  const inputTokens =
    typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : undefined;
  const candidateTokens =
    typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined;
  const thoughtsTokens =
    typeof usage.thoughtsTokenCount === 'number' ? usage.thoughtsTokenCount : undefined;
  const outputTokens =
    candidateTokens === undefined && thoughtsTokens === undefined
      ? undefined
      : (candidateTokens ?? 0) + (thoughtsTokens ?? 0);
  if (inputTokens === undefined && outputTokens === undefined) {
    return null;
  }

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

export const googleProvider: LLMProviderAdapter = {
  name: 'Google',
  prefix: 'google',
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
    if (!key) throw new Error(`${ENV_KEY} not set — required for Google models`);
    return {
      url: url(options.model),
      headers: headers(key),
      body: {
        systemInstruction: { parts: [{ text: options.system }] },
        contents: options.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: options.maxTokens },
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
    if (!key) throw new Error(`${ENV_KEY} not set — required for Google vision models`);
    return {
      url: url(options.model),
      headers: headers(key),
      body: {
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/png', data: options.base64Image } },
              { text: options.pageContext },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: options.maxTokens },
      },
    };
  },

  extractVisionResponse: extractText,

  extractUsage,
};
