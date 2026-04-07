import type { LLMTaskProposal, WorkerType } from './types.js';
import type { JudgeDecision } from './judge/types.js';
import { TRUNCATE_GROUP_KEY, DEFAULT_LLM_TIMEOUT_MS, JUDGE_LLM_TIMEOUT_MS } from './constants.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

type Provider = 'anthropic' | 'openai' | 'google';

function detectProvider(model: string): Provider {
  const lower = model.toLowerCase();
  if (lower.startsWith('openai/')) return 'openai';
  if (lower.startsWith('google/')) return 'google';
  return 'anthropic';
}

function stripProvider(model: string): string {
  const slash = model.indexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

export function hasLLMApiKey(model?: string): boolean {
  if (!model) {
    return !!(
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
  }

  const provider = detectProvider(model);
  return Boolean(process.env[PROVIDERS[provider].envKey]);
}

interface ProviderSpec {
  envKey: string;
  envName: string;
  url: (model: string, apiKey: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  body: (model: string, system: string, messages: ChatMessage[], maxTokens: number) => unknown;
  extract: (data: unknown) => string;
}

const PROVIDERS: Record<Provider, ProviderSpec> = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    envName: 'Anthropic',
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: (model, system, messages, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      system,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
    }),
    extract: (data) =>
      (data as { content?: Array<{ type: string; text: string }> }).content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('') ?? '',
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    envName: 'OpenAI',
    url: () => `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`,
    headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: (model, system, messages, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
    extract: (data) =>
      (data as { choices: Array<{ message: { content: string } }> }).choices[0]?.message?.content ??
      '',
  },
  google: {
    envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    envName: 'Google',
    url: (model, key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    headers: () => ({ 'content-type': 'application/json' }),
    body: (_, system, messages, maxTokens) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    extract: (data) =>
      (
        data as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
      ).candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join('') ?? '',
  },
};

async function callLLM(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens = 1024,
  requestTimeoutMs = DEFAULT_LLM_TIMEOUT_MS
): Promise<string> {
  const provider = detectProvider(model);
  const spec = PROVIDERS[provider];
  const apiKey = process.env[spec.envKey];
  if (!apiKey) throw new Error(`${spec.envKey} not set — required for ${spec.envName} models`);

  const modelId = stripProvider(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(spec.url(modelId, apiKey), {
      method: 'POST',
      headers: spec.headers(apiKey),
      body: JSON.stringify(spec.body(modelId, system, messages, maxTokens)),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `${spec.envName} API error ${response.status}: ${body.slice(0, TRUNCATE_GROUP_KEY)}`
    );
  }

  return spec.extract(await response.json());
}

export async function proposeLLMTasks(
  model: string,
  graphSummary: string,
  nodeDescription: string,
  allowedWorkerTypes: WorkerType[],
  requestTimeoutMs = 30_000
): Promise<LLMTaskProposal[] | null> {
  const system = `You are a QA test planner analyzing a web application's state graph.
Your job is to propose focused testing tasks for a specific page.

Respond with a JSON array of task proposals. Each task must have:
- "workerType": one of ${JSON.stringify(allowedWorkerTypes)}
- "objective": a clear, actionable instruction for a QA tester (1-2 sentences)
- "reason": why this task is valuable
- "priority": a number between 0 and 1 (higher = more important)

Return ONLY the JSON array, no markdown fencing, no explanation.
Propose 1-4 tasks. Focus on the highest-value testing activities for this specific page type.`;

  const userPrompt = `## Current State Graph
${graphSummary}

## Page to Plan For
${nodeDescription}

Propose testing tasks for this page.`;

  try {
    const raw = await callLLM(
      model,
      system,
      [{ role: 'user', content: userPrompt }],
      1024,
      requestTimeoutMs
    );

    // Extract JSON from response (handle possible markdown code fences)
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
    const parsed = JSON.parse(jsonStr) as unknown[];

    if (!Array.isArray(parsed)) return null;

    // Validate each proposal
    const proposals: LLMTaskProposal[] = [];
    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'workerType' in item &&
        'objective' in item &&
        'reason' in item
      ) {
        const p = item as Record<string, unknown>;
        const wt = String(p.workerType);
        if (
          allowedWorkerTypes.includes(wt as WorkerType) &&
          typeof p.objective === 'string' &&
          typeof p.reason === 'string'
        ) {
          proposals.push({
            workerType: wt as WorkerType,
            objective: p.objective,
            reason: p.reason,
            priority: typeof p.priority === 'number' ? Math.max(0, Math.min(1, p.priority)) : 0.5,
          });
        }
      }
    }

    return proposals.length > 0 ? proposals : null;
  } catch (error) {
    const label = error instanceof SyntaxError ? 'parse' : 'API';
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`LLM planner ${label} error (falling back to deterministic): ${msg}`);
    return null;
  }
}

export async function judgeObservationWithLLM(
  model: string,
  prompt: string,
  requestTimeoutMs = JUDGE_LLM_TIMEOUT_MS
): Promise<JudgeDecision> {
  const system = `You are a QA evidence judge.
Return a single JSON object with exactly these keys:
- "hypothesis": a sentence containing the word "should"
- "observation": a concise statement of what happened
- "alternativesConsidered": an array of concise alternative explanations
- "suggestedVerification": an array of concise next checks
- "confidence": one of "low", "medium", or "high"

Return ONLY JSON. No markdown fences, no explanation.`;

  const raw = await callLLM(
    model,
    system,
    [{ role: 'user', content: prompt }],
    512,
    requestTimeoutMs
  );
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();
  let parsed: Partial<JudgeDecision> & {
    confidence?: 'low' | 'medium' | 'high';
  };
  try {
    parsed = JSON.parse(jsonStr) as Partial<JudgeDecision> & {
      confidence?: 'low' | 'medium' | 'high';
    };
  } catch {
    parsed = {};
  }

  return {
    hypothesis:
      typeof parsed.hypothesis === 'string'
        ? parsed.hypothesis
        : 'The observed behavior should be verified.',
    observation:
      typeof parsed.observation === 'string'
        ? parsed.observation
        : 'The judged observation was inconclusive.',
    alternativesConsidered: Array.isArray(parsed.alternativesConsidered)
      ? parsed.alternativesConsidered.map(String)
      : [],
    suggestedVerification: Array.isArray(parsed.suggestedVerification)
      ? parsed.suggestedVerification.map(String)
      : [],
    confidence: parsed.confidence ?? 'medium',
  };
}
