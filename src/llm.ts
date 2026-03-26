/**
 * Lightweight LLM call utility for the planner.
 * Supports Anthropic, OpenAI, and Google Generative AI via fetch — no extra dependency.
 */
import type { LLMTaskProposal, WorkerType } from "./types.js";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

type Provider = "anthropic" | "openai" | "google";

function detectProvider(model: string): Provider {
  const lower = model.toLowerCase();
  if (lower.startsWith("openai/")) return "openai";
  if (lower.startsWith("google/")) return "google";
  // Default — covers "anthropic/..." and bare model strings
  return "anthropic";
}

/**
 * Extract the model name from a "provider/model" string.
 * e.g. "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
 */
function stripProvider(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

/**
 * Returns true if an API key is configured for any supported provider.
 */
export function hasLLMApiKey(): boolean {
  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function callAnthropic(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — required for Anthropic models");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: stripProvider(model),
      max_tokens: maxTokens,
      system,
      messages: messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Anthropic API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    content: Array<{ type: "text"; text: string }>;
  };
  return data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// ---------------------------------------------------------------------------
// OpenAI (compatible with Azure OpenAI by overriding OPENAI_BASE_URL)
// ---------------------------------------------------------------------------

async function callOpenAI(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set — required for OpenAI models");
  }

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const allMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: system },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: stripProvider(model),
      max_tokens: maxTokens,
      messages: allMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenAI API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Google Generative AI (Gemini)
// ---------------------------------------------------------------------------

async function callGoogle(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY not set — required for Google models"
    );
  }

  const modelId = stripProvider(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Google AI API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return (
    data.candidates?.[0]?.content?.parts
      ?.filter((p) => p.text)
      .map((p) => p.text)
      .join("") ?? ""
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function callLLM(
  model: string,
  system: string,
  messages: ChatMessage[],
  maxTokens = 1024
): Promise<string> {
  const provider = detectProvider(model);
  switch (provider) {
    case "anthropic":
      return callAnthropic(model, system, messages, maxTokens);
    case "openai":
      return callOpenAI(model, system, messages, maxTokens);
    case "google":
      return callGoogle(model, system, messages, maxTokens);
  }
}

/**
 * Ask the planner LLM to propose tasks for a state node based on its context.
 *
 * The LLM returns a JSON array of proposals. If parsing fails or the LLM is
 * unavailable, returns null so the caller can fall back to deterministic logic.
 */
export async function proposeLLMTasks(
  model: string,
  graphSummary: string,
  nodeDescription: string,
  allowedWorkerTypes: WorkerType[]
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
    const raw = await callLLM(model, system, [
      { role: "user", content: userPrompt },
    ]);

    // Extract JSON from response (handle possible markdown code fences)
    const jsonStr = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr) as unknown[];

    if (!Array.isArray(parsed)) return null;

    // Validate each proposal
    const proposals: LLMTaskProposal[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        "workerType" in item &&
        "objective" in item &&
        "reason" in item
      ) {
        const p = item as Record<string, unknown>;
        const wt = String(p.workerType);
        if (
          allowedWorkerTypes.includes(wt as WorkerType) &&
          typeof p.objective === "string" &&
          typeof p.reason === "string"
        ) {
          proposals.push({
            workerType: wt as WorkerType,
            objective: p.objective,
            reason: p.reason,
            priority: typeof p.priority === "number" ? Math.max(0, Math.min(1, p.priority)) : 0.5,
          });
        }
      }
    }

    return proposals.length > 0 ? proposals : null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`LLM planner call failed (falling back to deterministic): ${msg}`);
    return null;
  }
}
