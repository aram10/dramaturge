// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { LLMTaskProposal, WorkerType } from './types.js';
import type { JudgeDecision } from './judge/types.js';
import { DEFAULT_LLM_TIMEOUT_MS, JUDGE_LLM_TIMEOUT_MS } from './constants.js';
import { UNTRUSTED_PROMPT_INSTRUCTION, wrapUntrustedPromptContent } from './prompt-safety.js';
import { hasConfiguredProvider, sendChatCompletion } from './llm/index.js';

/**
 * Check whether the given model's provider (or any provider, if no model
 * is supplied) has its required API key(s) configured.
 */
export function hasLLMApiKey(model?: string): boolean {
  return hasConfiguredProvider(model);
}

async function callLLM(
  model: string,
  system: string,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  maxTokens = 1024,
  requestTimeoutMs = DEFAULT_LLM_TIMEOUT_MS
): Promise<string> {
  return sendChatCompletion({ model, system, messages, maxTokens, requestTimeoutMs });
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

  const trustBoundaryInstruction = UNTRUSTED_PROMPT_INSTRUCTION;

  const userPrompt = `${trustBoundaryInstruction}

## Current State Graph
${wrapUntrustedPromptContent('STATE GRAPH SUMMARY', graphSummary)}

## Page to Plan For
${wrapUntrustedPromptContent('PAGE DESCRIPTION', nodeDescription)}

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
  } catch {
    // LLM planner failed; caller will fall back to deterministic planner
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

  const safePrompt = `${UNTRUSTED_PROMPT_INSTRUCTION}

${wrapUntrustedPromptContent('JUDGE INPUT', prompt)}`;

  const raw = await callLLM(
    model,
    system,
    [{ role: 'user', content: safePrompt }],
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
