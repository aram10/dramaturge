// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Port interface for LLM inference providers.
 *
 * Each provider adapter implements this interface, allowing the engine to
 * call any LLM backend through a uniform contract (ports-and-adapters).
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Provider identifiers used as model-string prefixes. */
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'azure' | 'openrouter' | 'github';

/** Materialised HTTP request ready to be sent by the shared client. */
export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Core adapter interface every provider must implement.
 *
 * The adapter is responsible for:
 *  1. Deciding whether it is configured (env vars present).
 *  2. Building provider-specific HTTP requests.
 *  3. Extracting the text response from provider-specific JSON shapes.
 */
export interface LLMProviderAdapter {
  /** Human-readable provider name (for error messages). */
  readonly name: string;

  /** The model-string prefix that routes to this adapter (e.g. `'openai'`). */
  readonly prefix: ProviderId;

  /** Environment variable keys this adapter needs. */
  readonly envKeys: string[];

  /** Returns `true` when all required env vars are present. */
  isConfigured(): boolean;

  /** Build an HTTP request for a text chat completion. */
  buildChatRequest(options: {
    model: string;
    system: string;
    messages: ChatMessage[];
    maxTokens: number;
  }): ProviderRequest;

  /** Extract the assistant text from the provider's JSON response body. */
  extractChatResponse(data: unknown): string;

  /** Build an HTTP request for a vision (image + text) completion. */
  buildVisionRequest(options: {
    model: string;
    system: string;
    base64Image: string;
    pageContext: string;
    maxTokens: number;
  }): ProviderRequest;

  /** Extract the assistant text from a vision response. */
  extractVisionResponse(data: unknown): string;
}
