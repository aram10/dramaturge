/**
 * Lightweight LLM call utility for the planner.
 * Uses the Anthropic Messages API via fetch — no extra dependency.
 */
import type { LLMTaskProposal, WorkerType } from "./types.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: "text"; text: string }>;
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
 * Call the Anthropic Messages API and return the text response.
 * Requires ANTHROPIC_API_KEY in the environment.
 */
async function callAnthropic(
  model: string,
  system: string,
  messages: AnthropicMessage[],
  maxTokens = 1024
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — required for LLM planner");
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
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Anthropic API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as AnthropicResponse;
  return data.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
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
    const raw = await callAnthropic(model, system, [
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
