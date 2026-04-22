// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { anthropicProvider } from './anthropic.js';
import { openaiProvider } from './openai-compatible.js';
import { googleProvider } from './google.js';
import { azureFoundryProvider } from './azure-foundry.js';
import { openRouterProvider } from './openrouter.js';
import { githubModelsProvider } from './github-models.js';
import { ollamaProvider, DEFAULT_OLLAMA_BASE_URL } from './ollama.js';
import { customOpenAICompatibleProvider } from './custom-openai.js';

describe('provider adapters', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
    savedEnv.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    savedEnv.AZURE_AI_API_KEY = process.env.AZURE_AI_API_KEY;
    savedEnv.AZURE_AI_ENDPOINT = process.env.AZURE_AI_ENDPOINT;
    savedEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    savedEnv.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
    savedEnv.OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
    savedEnv.OPENAI_COMPATIBLE_BASE_URL = process.env.OPENAI_COMPATIBLE_BASE_URL;
    savedEnv.OPENAI_COMPATIBLE_API_KEY = process.env.OPENAI_COMPATIBLE_API_KEY;

    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_API_KEY;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  describe('anthropicProvider', () => {
    it('has correct metadata', () => {
      expect(anthropicProvider.prefix).toBe('anthropic');
      expect(anthropicProvider.name).toBe('Anthropic');
      expect(anthropicProvider.envKeys).toEqual(['ANTHROPIC_API_KEY']);
    });

    it('reports not configured when env var is missing', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(anthropicProvider.isConfigured()).toBe(false);
    });

    it('reports configured when env var is present', () => {
      process.env.ANTHROPIC_API_KEY = 'test';
      expect(anthropicProvider.isConfigured()).toBe(true);
    });

    it('builds chat request with correct structure', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const req = anthropicProvider.buildChatRequest({
        model: 'claude-sonnet-4-6',
        system: 'Be helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 256,
      });
      expect(req.url).toBe('https://api.anthropic.com/v1/messages');
      expect(req.headers['x-api-key']).toBe('test-key');
      expect(req.headers['anthropic-version']).toBe('2023-06-01');
      const body = req.body as Record<string, unknown>;
      expect(body.model).toBe('claude-sonnet-4-6');
      expect(body.system).toBe('Be helpful.');
    });

    it('extracts text from Anthropic response format', () => {
      const data = {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' world' },
        ],
      };
      expect(anthropicProvider.extractChatResponse(data)).toBe('Hello world');
    });

    it('builds vision request with base64 image source', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const req = anthropicProvider.buildVisionRequest({
        model: 'claude-sonnet-4-6',
        system: 'Analyze.',
        base64Image: 'aW1hZ2U=',
        pageContext: 'Dashboard page',
        maxTokens: 512,
      });
      const body = req.body as Record<string, unknown>;
      const messages = body.messages as Array<Record<string, unknown>>;
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0].type).toBe('image');
    });
  });

  describe('openaiProvider', () => {
    it('has correct metadata', () => {
      expect(openaiProvider.prefix).toBe('openai');
      expect(openaiProvider.name).toBe('OpenAI');
    });

    it('uses OPENAI_BASE_URL when set', () => {
      process.env.OPENAI_API_KEY = 'test';
      process.env.OPENAI_BASE_URL = 'https://custom.endpoint.com/v1';
      const req = openaiProvider.buildChatRequest({
        model: 'gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('https://custom.endpoint.com/v1/chat/completions');
    });

    it('extracts text from OpenAI response format', () => {
      const data = {
        choices: [{ message: { content: 'Test response' } }],
      };
      expect(openaiProvider.extractChatResponse(data)).toBe('Test response');
    });

    it('returns empty string for unexpected response shape', () => {
      expect(openaiProvider.extractChatResponse({})).toBe('');
      expect(openaiProvider.extractChatResponse({ choices: [] })).toBe('');
      expect(openaiProvider.extractChatResponse({ choices: [{}] })).toBe('');
    });

    it('includes model in request body', () => {
      process.env.OPENAI_API_KEY = 'test';
      const req = openaiProvider.buildChatRequest({
        model: 'gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      const body = req.body as Record<string, unknown>;
      expect(body.model).toBe('gpt-4.1');
    });
  });

  describe('googleProvider', () => {
    it('has correct metadata', () => {
      expect(googleProvider.prefix).toBe('google');
      expect(googleProvider.name).toBe('Google');
    });

    it('builds URL with model name', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test';
      const req = googleProvider.buildChatRequest({
        model: 'gemini-2.5-pro',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toContain('gemini-2.5-pro:generateContent');
    });

    it('maps assistant role to model', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test';
      const req = googleProvider.buildChatRequest({
        model: 'gemini-2.5-pro',
        system: 'sys',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
        maxTokens: 100,
      });
      const body = req.body as Record<string, unknown>;
      const contents = body.contents as Array<{ role: string }>;
      expect(contents[1].role).toBe('model');
    });

    it('extracts text from Google response format', () => {
      const data = {
        candidates: [{ content: { parts: [{ text: 'Google says hi' }] } }],
      };
      expect(googleProvider.extractChatResponse(data)).toBe('Google says hi');
    });
  });

  describe('azureFoundryProvider', () => {
    it('has correct metadata', () => {
      expect(azureFoundryProvider.prefix).toBe('azure');
      expect(azureFoundryProvider.name).toBe('Azure AI Foundry');
      expect(azureFoundryProvider.envKeys).toEqual(['AZURE_AI_API_KEY', 'AZURE_AI_ENDPOINT']);
    });

    it('requires both key and endpoint to be configured', () => {
      delete process.env.AZURE_AI_API_KEY;
      delete process.env.AZURE_AI_ENDPOINT;
      expect(azureFoundryProvider.isConfigured()).toBe(false);

      process.env.AZURE_AI_API_KEY = 'test';
      expect(azureFoundryProvider.isConfigured()).toBe(false);

      process.env.AZURE_AI_ENDPOINT = 'https://my.services.ai.azure.com';
      expect(azureFoundryProvider.isConfigured()).toBe(true);
    });

    it('throws clear error when AZURE_AI_ENDPOINT is missing', () => {
      process.env.AZURE_AI_API_KEY = 'test';
      delete process.env.AZURE_AI_ENDPOINT;
      expect(() =>
        azureFoundryProvider.buildChatRequest({
          model: 'gpt-4.1',
          system: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
        })
      ).toThrow('AZURE_AI_ENDPOINT not set');
    });

    it('builds URL from endpoint with api-version', () => {
      process.env.AZURE_AI_API_KEY = 'test-key';
      process.env.AZURE_AI_ENDPOINT = 'https://my.services.ai.azure.com';
      const req = azureFoundryProvider.buildChatRequest({
        model: 'gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toContain('my.services.ai.azure.com/models/chat/completions');
      expect(req.url).toContain('api-version=2024-05-01-preview');
    });

    it('uses api-key header for authentication', () => {
      process.env.AZURE_AI_API_KEY = 'azure-test-key';
      process.env.AZURE_AI_ENDPOINT = 'https://my.services.ai.azure.com';
      const req = azureFoundryProvider.buildChatRequest({
        model: 'gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.headers['api-key']).toBe('azure-test-key');
    });

    it('strips trailing slash from endpoint', () => {
      process.env.AZURE_AI_API_KEY = 'test';
      process.env.AZURE_AI_ENDPOINT = 'https://my.services.ai.azure.com/';
      const req = azureFoundryProvider.buildChatRequest({
        model: 'gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).not.toContain('//models');
    });
  });

  describe('openRouterProvider', () => {
    it('has correct metadata', () => {
      expect(openRouterProvider.prefix).toBe('openrouter');
      expect(openRouterProvider.name).toBe('OpenRouter');
      expect(openRouterProvider.envKeys).toEqual(['OPENROUTER_API_KEY']);
    });

    it('uses OpenRouter base URL', () => {
      process.env.OPENROUTER_API_KEY = 'or-test';
      const req = openRouterProvider.buildChatRequest({
        model: 'anthropic/claude-3.5-sonnet',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('passes through nested model name', () => {
      process.env.OPENROUTER_API_KEY = 'or-test';
      const req = openRouterProvider.buildChatRequest({
        model: 'anthropic/claude-3.5-sonnet',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      const body = req.body as Record<string, unknown>;
      expect(body.model).toBe('anthropic/claude-3.5-sonnet');
    });
  });

  describe('githubModelsProvider', () => {
    it('has correct metadata', () => {
      expect(githubModelsProvider.prefix).toBe('github');
      expect(githubModelsProvider.name).toBe('GitHub Models');
      expect(githubModelsProvider.envKeys).toEqual(['GITHUB_TOKEN']);
    });

    it('uses GitHub Models base URL', () => {
      process.env.GITHUB_TOKEN = 'gho_test';
      const req = githubModelsProvider.buildChatRequest({
        model: 'openai/gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('https://models.github.ai/inference/chat/completions');
    });

    it('uses Bearer auth with GITHUB_TOKEN', () => {
      process.env.GITHUB_TOKEN = 'gho_test-token';
      const req = githubModelsProvider.buildChatRequest({
        model: 'openai/gpt-4.1',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.headers.authorization).toBe('Bearer gho_test-token');
    });
  });

  describe('ollamaProvider', () => {
    beforeEach(() => {
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.OLLAMA_API_KEY;
    });

    it('has correct metadata', () => {
      expect(ollamaProvider.prefix).toBe('ollama');
      expect(ollamaProvider.name).toBe('Ollama');
      expect(ollamaProvider.envKeys).toEqual(['OLLAMA_BASE_URL', 'OLLAMA_API_KEY']);
    });

    it('is not configured when OLLAMA_BASE_URL is unset, even when Ollama is running locally', () => {
      expect(ollamaProvider.isConfigured()).toBe(false);
    });

    it('is configured when OLLAMA_BASE_URL is explicitly set', () => {
      process.env.OLLAMA_BASE_URL = DEFAULT_OLLAMA_BASE_URL;
      expect(ollamaProvider.isConfigured()).toBe(true);
    });

    it('treats empty OLLAMA_BASE_URL as unconfigured', () => {
      process.env.OLLAMA_BASE_URL = '   ';
      expect(ollamaProvider.isConfigured()).toBe(false);
    });

    it('builds chat request against the default local endpoint without auth headers', () => {
      process.env.OLLAMA_BASE_URL = DEFAULT_OLLAMA_BASE_URL;
      const req = ollamaProvider.buildChatRequest({
        model: 'llama3',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
      expect(req.headers.authorization).toBeUndefined();
      const body = req.body as Record<string, unknown>;
      expect(body.model).toBe('llama3');
    });

    it('attaches bearer auth when OLLAMA_API_KEY is set (for proxied deployments)', () => {
      process.env.OLLAMA_BASE_URL = 'https://ollama.internal/v1';
      process.env.OLLAMA_API_KEY = 'secret';
      const req = ollamaProvider.buildChatRequest({
        model: 'llama3',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('https://ollama.internal/v1/chat/completions');
      expect(req.headers.authorization).toBe('Bearer secret');
    });

    it('builds vision request without auth headers when keyless', () => {
      process.env.OLLAMA_BASE_URL = DEFAULT_OLLAMA_BASE_URL;
      const req = ollamaProvider.buildVisionRequest({
        model: 'llava',
        system: 'analyze',
        base64Image: 'aW1n',
        pageContext: 'page',
        maxTokens: 256,
      });
      expect(req.headers.authorization).toBeUndefined();
      expect(req.url).toBe('http://localhost:11434/v1/chat/completions');
    });
  });

  describe('customOpenAICompatibleProvider', () => {
    beforeEach(() => {
      delete process.env.OPENAI_COMPATIBLE_BASE_URL;
      delete process.env.OPENAI_COMPATIBLE_API_KEY;
    });

    it('has correct metadata', () => {
      expect(customOpenAICompatibleProvider.prefix).toBe('custom');
      expect(customOpenAICompatibleProvider.name).toBe('OpenAI-compatible');
      expect(customOpenAICompatibleProvider.envKeys).toEqual([
        'OPENAI_COMPATIBLE_BASE_URL',
        'OPENAI_COMPATIBLE_API_KEY',
      ]);
    });

    it('is not configured when OPENAI_COMPATIBLE_BASE_URL is unset', () => {
      expect(customOpenAICompatibleProvider.isConfigured()).toBe(false);
    });

    it('is configured as soon as the base URL is set, key optional', () => {
      process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://llm.corp.internal/v1';
      expect(customOpenAICompatibleProvider.isConfigured()).toBe(true);
    });

    it('throws a helpful error when asked to build a request with no base URL', () => {
      expect(() =>
        customOpenAICompatibleProvider.buildChatRequest({
          model: 'anything',
          system: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
        })
      ).toThrow(/base URL not set/);
    });

    it('builds request against the configured base URL', () => {
      process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://llm.corp.internal/v1';
      process.env.OPENAI_COMPATIBLE_API_KEY = 'token';
      const req = customOpenAICompatibleProvider.buildChatRequest({
        model: 'my-model',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('https://llm.corp.internal/v1/chat/completions');
      expect(req.headers.authorization).toBe('Bearer token');
    });

    it('normalizes custom base URL by trimming whitespace and trailing slashes', () => {
      process.env.OPENAI_COMPATIBLE_BASE_URL = '  https://llm.corp.internal/v1/  ';
      const req = customOpenAICompatibleProvider.buildChatRequest({
        model: 'my-model',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.url).toBe('https://llm.corp.internal/v1/chat/completions');
    });

    it('omits auth header when keyless but base URL is configured', () => {
      process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://llama-cpp.local:8080/v1';
      const req = customOpenAICompatibleProvider.buildChatRequest({
        model: 'llama',
        system: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
      });
      expect(req.headers.authorization).toBeUndefined();
    });
  });
});
