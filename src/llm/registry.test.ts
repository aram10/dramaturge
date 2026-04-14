// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveProvider,
  stripProviderPrefix,
  hasConfiguredProvider,
  detectProviderFromEnv,
  allProviders,
} from './registry.js';

describe('registry', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    savedEnv.AZURE_AI_API_KEY = process.env.AZURE_AI_API_KEY;
    savedEnv.AZURE_AI_ENDPOINT = process.env.AZURE_AI_ENDPOINT;
    savedEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    savedEnv.GITHUB_TOKEN = process.env.GITHUB_TOKEN;

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.AZURE_AI_API_KEY;
    delete process.env.AZURE_AI_ENDPOINT;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GITHUB_TOKEN;
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

  describe('resolveProvider', () => {
    it('returns Anthropic for anthropic/ prefix', () => {
      expect(resolveProvider('anthropic/claude-sonnet-4-6').name).toBe('Anthropic');
    });

    it('returns OpenAI for openai/ prefix', () => {
      expect(resolveProvider('openai/gpt-4.1').name).toBe('OpenAI');
    });

    it('returns Google for google/ prefix', () => {
      expect(resolveProvider('google/gemini-2.5-pro').name).toBe('Google');
    });

    it('returns Azure AI Foundry for azure/ prefix', () => {
      expect(resolveProvider('azure/gpt-4.1').name).toBe('Azure AI Foundry');
    });

    it('returns OpenRouter for openrouter/ prefix', () => {
      expect(resolveProvider('openrouter/anthropic/claude-3.5-sonnet').name).toBe('OpenRouter');
    });

    it('returns GitHub Models for github/ prefix', () => {
      expect(resolveProvider('github/openai/gpt-4.1').name).toBe('GitHub Models');
    });

    it('defaults to Anthropic for unprefixed model', () => {
      expect(resolveProvider('claude-sonnet-4-6').name).toBe('Anthropic');
    });

    it('is case-insensitive for prefix matching', () => {
      expect(resolveProvider('OpenAI/gpt-4.1').name).toBe('OpenAI');
      expect(resolveProvider('GOOGLE/gemini-2.5-pro').name).toBe('Google');
    });
  });

  describe('stripProviderPrefix', () => {
    it('removes recognized prefix', () => {
      expect(stripProviderPrefix('openai/gpt-4.1')).toBe('gpt-4.1');
    });

    it('removes first prefix only for nested model names', () => {
      expect(stripProviderPrefix('openrouter/anthropic/claude-3.5-sonnet')).toBe(
        'anthropic/claude-3.5-sonnet'
      );
    });

    it('returns model as-is when there is no prefix', () => {
      expect(stripProviderPrefix('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    });

    it('returns model as-is for unknown prefix', () => {
      expect(stripProviderPrefix('foo/bar')).toBe('foo/bar');
    });
  });

  describe('hasConfiguredProvider', () => {
    it('returns false when no env vars are set', () => {
      expect(hasConfiguredProvider()).toBe(false);
    });

    it('returns true when Anthropic key is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      expect(hasConfiguredProvider()).toBe(true);
    });

    it('checks specific provider for a given model', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      expect(hasConfiguredProvider('openai/gpt-4.1')).toBe(true);
      expect(hasConfiguredProvider('anthropic/claude-sonnet-4-6')).toBe(false);
    });

    it('checks Azure requires both key and endpoint', () => {
      process.env.AZURE_AI_API_KEY = 'test-key';
      expect(hasConfiguredProvider('azure/gpt-4.1')).toBe(false);

      process.env.AZURE_AI_ENDPOINT = 'https://my.services.ai.azure.com';
      expect(hasConfiguredProvider('azure/gpt-4.1')).toBe(true);
    });

    it('checks OpenRouter key', () => {
      process.env.OPENROUTER_API_KEY = 'or-test';
      expect(hasConfiguredProvider('openrouter/anthropic/claude-3.5-sonnet')).toBe(true);
    });

    it('checks GitHub token', () => {
      process.env.GITHUB_TOKEN = 'gho_test';
      expect(hasConfiguredProvider('github/openai/gpt-4.1')).toBe(true);
    });
  });

  describe('detectProviderFromEnv', () => {
    it('defaults to anthropic when nothing is set', () => {
      expect(detectProviderFromEnv()).toBe('anthropic');
    });

    it('detects anthropic first when set', () => {
      process.env.ANTHROPIC_API_KEY = 'test';
      process.env.OPENAI_API_KEY = 'test';
      expect(detectProviderFromEnv()).toBe('anthropic');
    });

    it('detects openai when only openai is set', () => {
      process.env.OPENAI_API_KEY = 'test';
      expect(detectProviderFromEnv()).toBe('openai');
    });

    it('detects openrouter when only openrouter key is set', () => {
      process.env.OPENROUTER_API_KEY = 'or-test';
      expect(detectProviderFromEnv()).toBe('openrouter');
    });

    it('detects github when only github token is set', () => {
      process.env.GITHUB_TOKEN = 'gho_test';
      expect(detectProviderFromEnv()).toBe('github');
    });
  });

  describe('allProviders', () => {
    it('returns a map with all 6 providers', () => {
      const providers = allProviders();
      expect(providers.size).toBe(6);
      expect([...providers.keys()]).toEqual([
        'anthropic',
        'openai',
        'google',
        'azure',
        'openrouter',
        'github',
      ]);
    });
  });
});
