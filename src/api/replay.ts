// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { ApiReplayRequest, ApiReplayResponse, ApiRequestContextLike } from './types.js';

async function resolveHeaders(
  response: Awaited<ReturnType<ApiRequestContextLike['fetch']>>
): Promise<Record<string, string>> {
  return Promise.resolve(response.headers());
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function parseResponseBody(contentType: string | undefined, text: string): unknown {
  if (!text) {
    return undefined;
  }

  if (contentType?.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

export async function replayApiRequest(
  context: ApiRequestContextLike,
  request: ApiReplayRequest
): Promise<ApiReplayResponse> {
  const response = await context.fetch(request.url, {
    method: request.method,
    ...(request.headers ? { headers: request.headers } : {}),
    ...(request.data !== undefined ? { data: request.data } : {}),
  });

  const headers = normalizeHeaders(await resolveHeaders(response));
  const text = await response.text();

  return {
    status: response.status(),
    body: parseResponseBody(headers['content-type'], text),
  };
}
