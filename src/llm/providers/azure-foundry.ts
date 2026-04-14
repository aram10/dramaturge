// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Azure AI Foundry inference adapter.
 *
 * Endpoint format:
 *   POST {AZURE_AI_ENDPOINT}/models/chat/completions?api-version=2024-05-01-preview
 *
 * Authentication:
 *   api-key: <AZURE_AI_API_KEY>
 *
 * Request/response shape is OpenAI-compatible, but the model name goes
 * in the JSON body, and the endpoint already includes `/models`.
 *
 * Required environment variables:
 *   AZURE_AI_ENDPOINT  — e.g. https://my-project.services.ai.azure.com
 *   AZURE_AI_API_KEY   — API key for the Foundry resource
 */

import { createOpenAICompatibleProvider } from './openai-compatible.js';

const API_VERSION = '2024-05-01-preview';

function requireEndpoint(): string {
  const endpoint = process.env.AZURE_AI_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      'AZURE_AI_ENDPOINT not set — required for Azure AI Foundry models. ' +
        'Set it to your Foundry resource URL (e.g. https://my-project.services.ai.azure.com).'
    );
  }
  return endpoint.replace(/\/+$/, '');
}

export const azureFoundryProvider = createOpenAICompatibleProvider({
  name: 'Azure AI Foundry',
  prefix: 'azure',
  envKeys: ['AZURE_AI_API_KEY', 'AZURE_AI_ENDPOINT'],
  getApiKey: () => process.env.AZURE_AI_API_KEY,
  getBaseUrl: () => `${requireEndpoint()}/models`,
  buildAuthHeaders: (key) => ({
    'api-key': key,
    'extra-parameters': 'ignore',
  }),
});

// Override buildChatRequest and buildVisionRequest to append api-version query param.
// We wrap the base methods to add ?api-version= to URLs.
const baseBuildChat = azureFoundryProvider.buildChatRequest.bind(azureFoundryProvider);
const baseBuildVision = azureFoundryProvider.buildVisionRequest.bind(azureFoundryProvider);
const baseIsConfigured = azureFoundryProvider.isConfigured.bind(azureFoundryProvider);

azureFoundryProvider.isConfigured = () => {
  return baseIsConfigured() && !!process.env.AZURE_AI_ENDPOINT;
};

azureFoundryProvider.buildChatRequest = (options) => {
  const req = baseBuildChat(options);
  req.url = appendApiVersion(req.url);
  return req;
};

azureFoundryProvider.buildVisionRequest = (options) => {
  const req = baseBuildVision(options);
  req.url = appendApiVersion(req.url);
  return req;
};

function appendApiVersion(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}api-version=${API_VERSION}`;
}
