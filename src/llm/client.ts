// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import {
  TRUNCATE_GROUP_KEY,
  MAX_LLM_RETRIES,
  LLM_RETRY_BASE_DELAY_MS,
  LLM_RETRY_MAX_DELAY_MS,
} from '../constants.js';
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
 *
 * Transient failures (HTTP 429, 5xx, and network/abort errors) are retried with
 * exponential backoff up to {@link MAX_LLM_RETRIES} times. The abort timer stays
 * armed until the response body has been fully read so a stalled body read cannot
 * hang the engine indefinitely.
 */
async function executeProviderRequest(
  req: { url: string; headers: Record<string, string>; body: unknown },
  adapter: LLMProviderAdapter,
  requestTimeoutMs: number
): Promise<unknown> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      return await sendOnce(req, adapter, requestTimeoutMs);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      if (attempt >= MAX_LLM_RETRIES || !isRetryableError(err)) {
        throw err;
      }
      await delay(backoffDelayMs(attempt));
    }
  }

  // Unreachable: the loop either returns or throws, but satisfies the type checker.
  throw lastError ?? new Error(`${adapter.name} API request failed`);
}

/** Perform a single attempt, keeping the abort timer armed through the body read. */
async function sendOnce(
  req: { url: string; headers: Record<string, string>; body: unknown },
  adapter: LLMProviderAdapter,
  requestTimeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const safeBody = redactSecrets(body, adapter);
      throw new HttpStatusError(
        response.status,
        `${adapter.name} API error ${response.status}: ${safeBody.slice(0, TRUNCATE_GROUP_KEY)}`
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(`${adapter.name} API request timed out after ${requestTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Redact all env-var API key values to avoid leaking secrets in logs. */
function redactSecrets(body: string, adapter: LLMProviderAdapter): string {
  let safeBody = body;
  for (const envKey of adapter.envKeys) {
    const secret = process.env[envKey];
    if (secret) {
      safeBody = redactApiKey(safeBody, secret);
    }
  }
  return safeBody;
}

/** Error carrying an HTTP status so retry logic can inspect it. */
class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

/** Error raised when a request (including its body read) exceeds the timeout. */
class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Decide whether a failure is transient and worth retrying. */
function isRetryableError(error: Error): boolean {
  if (error instanceof TimeoutError) return true;
  if (error instanceof HttpStatusError) {
    return error.status === 429 || error.status >= 500;
  }
  // Network-level fetch failures (DNS, connection reset, etc.) are transient.
  return error.name === 'TypeError' || error.name === 'FetchError';
}

/** Exponential backoff with a cap, based on the zero-indexed attempt number. */
function backoffDelayMs(attempt: number): number {
  return Math.min(LLM_RETRY_BASE_DELAY_MS * 2 ** attempt, LLM_RETRY_MAX_DELAY_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
