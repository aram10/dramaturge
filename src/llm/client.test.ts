// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendChatCompletion, sendVisionCompletion, redactApiKey } from './client.js';

describe('client', () => {
  const originalFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    savedEnv.AZURE_AI_API_KEY = process.env.AZURE_AI_API_KEY;
    savedEnv.AZURE_AI_ENDPOINT = process.env.AZURE_AI_ENDPOINT;
    savedEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
  });

  describe('redactApiKey', () => {
    it('replaces all occurrences of the key', () => {
      expect(redactApiKey('key=abc123 and abc123 again', 'abc123')).toBe(
        'key=[REDACTED] and [REDACTED] again'
      );
    });
  });

  describe('sendChatCompletion', () => {
    it('routes anthropic model to Anthropic API', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello from Anthropic' }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendChatCompletion({
        model: 'anthropic/claude-sonnet-4-6',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('Hello from Anthropic');
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect((init as RequestInit).headers).toEqual(
        expect.objectContaining({ 'x-api-key': 'test-anthropic-key' })
      );
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('claude-sonnet-4-6');
    });

    it('routes openai model to OpenAI API', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      delete process.env.OPENAI_BASE_URL;

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from OpenAI' } }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendChatCompletion({
        model: 'openai/gpt-4.1',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('Hello from OpenAI');
      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain('openai.com');
      expect(url).toContain('/chat/completions');
    });

    it('routes google model to Google API', async () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-google-key';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Hello from Google' }] } }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendChatCompletion({
        model: 'google/gemini-2.5-pro',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('Hello from Google');
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('gemini-2.5-pro');
      expect(
        (init as RequestInit & { headers: Record<string, string> }).headers['x-goog-api-key']
      ).toBe('test-google-key');
    });

    it('routes azure model to Azure Foundry API', async () => {
      process.env.AZURE_AI_API_KEY = 'test-azure-key';
      process.env.AZURE_AI_ENDPOINT = 'https://my-project.services.ai.azure.com';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from Azure' } }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendChatCompletion({
        model: 'azure/gpt-4.1',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('Hello from Azure');
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain('my-project.services.ai.azure.com');
      expect(url).toContain('/models/chat/completions');
      expect(url).toContain('api-version=');
      expect((init as RequestInit & { headers: Record<string, string> }).headers['api-key']).toBe(
        'test-azure-key'
      );
    });

    it('routes openrouter model to OpenRouter API', async () => {
      process.env.OPENROUTER_API_KEY = 'or-test-key';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from OpenRouter' } }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendChatCompletion({
        model: 'openrouter/anthropic/claude-3.5-sonnet',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('Hello from OpenRouter');
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(
        (init as RequestInit & { headers: Record<string, string> }).headers.authorization
      ).toBe('Bearer or-test-key');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('anthropic/claude-3.5-sonnet');
    });

    it('routes github model to GitHub Models API', async () => {
      process.env.GITHUB_TOKEN = 'gho_test-token';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hello from GitHub' } }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendChatCompletion({
        model: 'github/openai/gpt-4.1',
        system: 'You are helpful.',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 100,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('Hello from GitHub');
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://models.github.ai/inference/chat/completions');
      expect(
        (init as RequestInit & { headers: Record<string, string> }).headers.authorization
      ).toBe('Bearer gho_test-token');
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe('openai/gpt-4.1');
    });

    it('throws when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(
        sendChatCompletion({
          model: 'anthropic/claude-sonnet-4-6',
          system: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
          requestTimeoutMs: 5000,
        })
      ).rejects.toThrow('ANTHROPIC_API_KEY not set');
    });

    it('throws with redacted body on HTTP error', async () => {
      process.env.ANTHROPIC_API_KEY = 'secret-key-123';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid key: secret-key-123',
      }) as unknown as typeof fetch;

      await expect(
        sendChatCompletion({
          model: 'anthropic/claude-sonnet-4-6',
          system: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 100,
          requestTimeoutMs: 5000,
        })
      ).rejects.toThrow('[REDACTED]');
    });
  });

  describe('sendVisionCompletion', () => {
    it('routes anthropic vision to Anthropic API with image payload', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'I see a dashboard' }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendVisionCompletion({
        model: 'anthropic/claude-sonnet-4-6',
        system: 'Analyze this.',
        base64Image: 'base64data',
        pageContext: 'Page context',
        maxTokens: 512,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('I see a dashboard');
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.messages[0].content[0].type).toBe('image');
      expect(body.messages[0].content[0].source.data).toBe('base64data');
    });

    it('routes openai vision to OpenAI API with image_url payload', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'I see a form' } }],
        }),
      }) as unknown as typeof fetch;

      const result = await sendVisionCompletion({
        model: 'openai/gpt-4o',
        system: 'Analyze this.',
        base64Image: 'base64data',
        pageContext: 'Page context',
        maxTokens: 512,
        requestTimeoutMs: 5000,
      });

      expect(result).toBe('I see a form');
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.messages[1].content[0].type).toBe('image_url');
      expect(body.messages[1].content[0].image_url.url).toContain('data:image/png;base64,');
    });
  });
});
