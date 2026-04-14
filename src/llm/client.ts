// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { ChatMessage, LLMProviderAdapter } from './types.js';
import { resolveProvider, stripProviderPrefix } from './registry.js';

/**
 * Redact an API key from an error message body.
 */
export function redactApiKey(text: string, apiKey: string): string {
  return text.replaceAll(apiKey, '[REDACTED]');
}

/**
 * Send a text chat completion request to the appropriate provider.
 */
export async function sendChatCompletion(options: {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  requestTimeoutMs: number;
}): Promise<string> {
  const adapter = resolveProvider(options.model);
  const modelId = stripProviderPrefix(options.model);

  const req = adapter.buildChatRequest({
    model: modelId,
    system: options.system,
    messages: options.messages,
    maxTokens: options.maxTokens,
  });

  const data = await executeProviderRequest(req, adapter, options.requestTimeoutMs);
  return adapter.extractChatResponse(data);
}

/**
 * Send a vision completion request (image + text) to the appropriate provider.
 */
export async function sendVisionCompletion(options: {
  model: string;
  system: string;
  base64Image: string;
  pageContext: string;
  maxTokens: number;
  requestTimeoutMs: number;
}): Promise<string> {
  const adapter = resolveProvider(options.model);
  const modelId = stripProviderPrefix(options.model);

  const req = adapter.buildVisionRequest({
    model: modelId,
    system: options.system,
    base64Image: options.base64Image,
    pageContext: options.pageContext,
    maxTokens: options.maxTokens,
  });

  const data = await executeProviderRequest(req, adapter, options.requestTimeoutMs);
  return adapter.extractVisionResponse(data);
}

/**
 * Shared HTTP logic: send the materialised request with timeout + error handling.
 */
async function executeProviderRequest(
  req: { url: string; headers: Record<string, string>; body: unknown },
  adapter: LLMProviderAdapter,
  requestTimeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Redact all env-var API key values to avoid leaking secrets in logs.
    let safeBody = body;
    for (const envKey of adapter.envKeys) {
      const secret = process.env[envKey];
      if (secret) {
        safeBody = redactApiKey(safeBody, secret);
      }
    }
    throw new Error(`${adapter.name} API error ${response.status}: ${safeBody.slice(0, 500)}`);
  }

  return response.json();
}
