import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasLLMApiKey, proposeLLMTasks } from './llm.js';

describe('proposeLLMTasks', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.ANTHROPIC_API_KEY;
  const originalOpenAiEnv = process.env.OPENAI_API_KEY;
  const originalGoogleEnv = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (originalOpenAiEnv !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAiEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (originalGoogleEnv !== undefined) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleEnv;
    } else {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    }
  });

  it("checks planner readiness against the model's provider", () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    expect(hasLLMApiKey('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(hasLLMApiKey('openai/gpt-4.1')).toBe(false);

    process.env.OPENAI_API_KEY = 'openai-key';
    expect(hasLLMApiKey('openai/gpt-4.1')).toBe(true);
    expect(hasLLMApiKey('google/gemini-2.5-flash')).toBe(false);
  });

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await proposeLLMTasks(
      'anthropic/claude-sonnet-4-6',
      'graph summary',
      'node description',
      ['navigation', 'form', 'crud']
    );

    expect(result).toBeNull();
  });

  it('parses valid LLM response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                workerType: 'form',
                objective: 'Test login form validation',
                reason: 'Form has multiple required fields',
                priority: 0.85,
              },
              {
                workerType: 'navigation',
                objective: 'Discover sidebar links',
                reason: 'Dashboard has navigation panel',
                priority: 0.6,
              },
            ]),
          },
        ],
      }),
    }) as any;

    const result = await proposeLLMTasks(
      'anthropic/claude-sonnet-4-6',
      'graph: 2 nodes',
      'page type: form',
      ['navigation', 'form', 'crud']
    );

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].workerType).toBe('form');
    expect(result![0].priority).toBe(0.85);
    expect(result![1].workerType).toBe('navigation');
  });

  it('strips markdown code fences from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '```json\n[{"workerType":"crud","objective":"Test list","reason":"Has table","priority":0.7}]\n```',
          },
        ],
      }),
    }) as any;

    const result = await proposeLLMTasks('anthropic/claude-sonnet-4-6', 'graph', 'desc', [
      'navigation',
      'form',
      'crud',
    ]);

    expect(result).toHaveLength(1);
    expect(result![0].workerType).toBe('crud');
  });

  it('filters out proposals with invalid worker types', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { workerType: 'form', objective: 'Test form', reason: 'ok', priority: 0.5 },
              { workerType: 'invalid-type', objective: 'Bad', reason: 'nope', priority: 0.5 },
            ]),
          },
        ],
      }),
    }) as any;

    const result = await proposeLLMTasks('anthropic/claude-sonnet-4-6', 'graph', 'desc', [
      'navigation',
      'form',
      'crud',
    ]);

    expect(result).toHaveLength(1);
    expect(result![0].workerType).toBe('form');
  });

  it('returns null on API error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    }) as any;

    // Should not throw — returns null
    const result = await proposeLLMTasks('anthropic/claude-sonnet-4-6', 'graph', 'desc', [
      'navigation',
    ]);

    expect(result).toBeNull();
  });

  it('returns null on malformed JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'not valid json at all' }],
      }),
    }) as any;

    const result = await proposeLLMTasks('anthropic/claude-sonnet-4-6', 'graph', 'desc', [
      'navigation',
    ]);

    expect(result).toBeNull();
  });

  it('clamps priority to [0, 1] range', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { workerType: 'navigation', objective: 'test', reason: 'r', priority: 5.0 },
              { workerType: 'form', objective: 'test2', reason: 'r', priority: -1.0 },
            ]),
          },
        ],
      }),
    }) as any;

    const result = await proposeLLMTasks('anthropic/claude-sonnet-4-6', 'graph', 'desc', [
      'navigation',
      'form',
    ]);

    expect(result).toHaveLength(2);
    expect(result![0].priority).toBe(1); // clamped to 1
    expect(result![1].priority).toBe(0); // clamped to 0
  });

  it('sends correct model name stripping provider prefix', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { workerType: 'navigation', objective: 'test', reason: 'r', priority: 0.5 },
            ]),
          },
        ],
      }),
    }) as any;

    await proposeLLMTasks('anthropic/claude-sonnet-4-6', 'graph', 'desc', ['navigation']);

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  it('returns null when the LLM request times out', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockImplementation(
      (_url, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('Request aborted'));
          });
        })
    ) as any;

    const resultPromise = proposeLLMTasks(
      'anthropic/claude-sonnet-4-6',
      'graph',
      'desc',
      ['navigation'],
      25
    );

    await vi.advanceTimersByTimeAsync(30);
    const result = await resultPromise;

    expect(result).toBeNull();
    vi.useRealTimers();
  });
});
