import { shortId } from "../constants.js";
import { hasLLMApiKey } from "../llm.js";
import type { Evidence, RawFinding, FindingSeverity, FindingCategory, PageType } from "../types.js";

export interface VisionAnalysisOptions {
  areaName: string;
  route: string;
  pageType: PageType;
  model: string;
  fullPage: boolean;
  maxResponseTokens: number;
  requestTimeoutMs: number;
}

export interface VisionAnalysisResult {
  findings: RawFinding[];
  evidence: Evidence[];
  /** Structured page description the worker can use for richer context. */
  pageDescription: string;
}

export interface VisionAnomaly {
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
}

export interface VisionPageAnalysis {
  layoutDescription: string;
  components: string[];
  anomalies: VisionAnomaly[];
}

const VISION_SYSTEM_PROMPT = `You are a visual QA analyst examining a screenshot of a web page.

Your tasks:
1. Describe the page layout: header, navigation, sidebar, main content, footer, modals, etc.
2. List visible UI components (buttons, forms, tables, charts, images, etc.).
3. Identify visual anomalies — issues that a DOM-only analysis would miss:
   - Overlapping or clipped elements
   - Truncated or overflowing text
   - Broken or misaligned layouts
   - Inconsistent spacing or alignment
   - Poor color contrast (text hard to read)
   - Broken image placeholders or missing icons
   - Empty areas that look unintentional
   - Elements rendering outside their containers

Respond with ONLY a JSON object (no markdown fences, no explanation) with these keys:
- "layoutDescription": a 1-3 sentence summary of the page layout and visual hierarchy
- "components": an array of short strings naming visible UI components (e.g., "navigation bar", "search input", "data table with 5 columns")
- "anomalies": an array of objects, each with:
  - "category": one of "Bug", "UX Concern", "Accessibility Issue", "Visual Glitch"
  - "severity": one of "Critical", "Major", "Minor", "Trivial"
  - "title": a short title for the issue
  - "description": what you observed and why it matters

If the page looks correct with no issues, return an empty anomalies array.
Be conservative — only report clear visual problems, not stylistic preferences.`;

type Provider = "anthropic" | "openai" | "google";

function detectProvider(model: string): Provider {
  const lower = model.toLowerCase();
  if (lower.startsWith("openai/")) return "openai";
  if (lower.startsWith("google/")) return "google";
  return "anthropic";
}

function stripProvider(model: string): string {
  const slash = model.indexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

interface ProviderVisionSpec {
  envKey: string;
  envName: string;
  url: (model: string) => string;
  headers: (apiKey: string) => Record<string, string>;
  body: (model: string, system: string, base64Image: string, pageContext: string, maxTokens: number) => unknown;
  extract: (data: unknown) => string;
}

const VISION_PROVIDERS: Record<Provider, ProviderVisionSpec> = {
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    envName: "Anthropic",
    url: () => "https://api.anthropic.com/v1/messages",
    headers: (key) => ({
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    body: (model, system, base64Image, pageContext, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: base64Image },
            },
            { type: "text", text: pageContext },
          ],
        },
      ],
    }),
    extract: (data) =>
      (data as { content?: Array<{ type: string; text: string }> }).content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("") ?? "",
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    envName: "OpenAI",
    url: () =>
      `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`,
    headers: (key) => ({
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    }),
    body: (model, system, base64Image, pageContext, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64Image}` },
            },
            { type: "text", text: pageContext },
          ],
        },
      ],
    }),
    extract: (data) =>
      (
        data as { choices: Array<{ message: { content: string } }> }
      ).choices[0]?.message?.content ?? "",
  },
  google: {
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    envName: "Google",
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: (key) => ({ "content-type": "application/json", "x-goog-api-key": key }),
    body: (_, system, base64Image, pageContext, maxTokens) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Image } },
            { text: pageContext },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
    extract: (data) =>
      (
        data as {
          candidates: Array<{
            content: { parts: Array<{ text: string }> };
          }>;
        }
      ).candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join("") ?? "",
  },
};

function redactApiKey(text: string, apiKey: string): string {
  return text.replaceAll(apiKey, "[REDACTED]");
}

async function callVisionLLM(
  model: string,
  system: string,
  base64Image: string,
  pageContext: string,
  maxTokens: number,
  requestTimeoutMs: number,
): Promise<string> {
  const provider = detectProvider(model);
  const spec = VISION_PROVIDERS[provider];
  const apiKey = process.env[spec.envKey];
  if (!apiKey) {
    throw new Error(
      `${spec.envKey} not set — required for ${spec.envName} vision models`,
    );
  }

  const modelId = stripProvider(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(spec.url(modelId), {
      method: "POST",
      headers: spec.headers(apiKey),
      body: JSON.stringify(
        spec.body(modelId, system, base64Image, pageContext, maxTokens),
      ),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${spec.envName} Vision API error ${response.status}: ${redactApiKey(body, apiKey).slice(0, 200)}`,
    );
  }

  return spec.extract(await response.json());
}

export function parseVisionResponse(raw: string): VisionPageAnalysis {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : raw.trim();

  let parsed: Partial<VisionPageAnalysis>;
  try {
    parsed = JSON.parse(jsonStr) as Partial<VisionPageAnalysis>;
  } catch {
    return {
      layoutDescription: raw.slice(0, 500),
      components: [],
      anomalies: [],
    };
  }

  const layoutDescription =
    typeof parsed.layoutDescription === "string"
      ? parsed.layoutDescription
      : "";

  const components = Array.isArray(parsed.components)
    ? parsed.components.filter((c): c is string => typeof c === "string")
    : [];

  const validCategories = new Set<string>([
    "Bug",
    "UX Concern",
    "Accessibility Issue",
    "Visual Glitch",
  ]);
  const validSeverities = new Set<string>([
    "Critical",
    "Major",
    "Minor",
    "Trivial",
  ]);

  const anomalies: VisionAnomaly[] = [];
  if (Array.isArray(parsed.anomalies)) {
    for (const a of parsed.anomalies) {
      if (
        a &&
        typeof a === "object" &&
        "title" in a &&
        typeof a.title === "string" &&
        "description" in a &&
        typeof a.description === "string"
      ) {
        const category =
          "category" in a && validCategories.has(a.category as string)
            ? (a.category as FindingCategory)
            : "Visual Glitch";
        const severity =
          "severity" in a && validSeverities.has(a.severity as string)
            ? (a.severity as FindingSeverity)
            : "Minor";

        anomalies.push({ category, severity, title: a.title, description: a.description });
      }
    }
  }

  return { layoutDescription, components, anomalies };
}

export async function analyzeScreenshot(
  page: { screenshot: (opts: { fullPage: boolean }) => Promise<Buffer> },
  options: VisionAnalysisOptions,
): Promise<VisionAnalysisResult> {
  if (!hasLLMApiKey(options.model)) {
    return { findings: [], evidence: [], pageDescription: "" };
  }

  const screenshotBuffer = await page.screenshot({
    fullPage: options.fullPage,
  });
  const base64Image = screenshotBuffer.toString("base64");

  const pageContext = `Page URL: ${options.route}\nPage type: ${options.pageType}\nArea: ${options.areaName}\n\nAnalyze this screenshot for layout structure and visual anomalies.`;

  const raw = await callVisionLLM(
    options.model,
    VISION_SYSTEM_PROMPT,
    base64Image,
    pageContext,
    options.maxResponseTokens,
    options.requestTimeoutMs,
  );

  const analysis = parseVisionResponse(raw);

  const findings: RawFinding[] = [];
  const evidence: Evidence[] = [];

  if (analysis.anomalies.length > 0) {
    const evidenceId = `ev-${shortId()}`;
    evidence.push({
      id: evidenceId,
      type: "vision-analysis",
      summary: `Vision analysis for ${options.areaName}: ${analysis.anomalies.length} anomaly(ies) detected`,
      timestamp: new Date().toISOString(),
      areaName: options.areaName,
      relatedFindingIds: [],
    });

    for (const anomaly of analysis.anomalies) {
      const findingRef = `fid-${shortId()}`;
      evidence[0].relatedFindingIds.push(findingRef);

      findings.push({
        ref: findingRef,
        category: anomaly.category,
        severity: anomaly.severity,
        title: anomaly.title,
        stepsToReproduce: [`Navigate to ${options.route}`],
        expected: "The page should render without visual anomalies",
        actual: anomaly.description,
        evidenceIds: [evidenceId],
        verdict: {
          hypothesis:
            "The page layout should be visually correct and free of rendering issues.",
          observation: anomaly.description,
          evidenceChain: [
            `vision-model=${options.model}`,
            `page-type=${options.pageType}`,
            `area=${options.areaName}`,
          ],
          alternativesConsidered: [
            "The anomaly may be intentional design or dynamic content.",
          ],
          suggestedVerification: [
            "Manually inspect the page to confirm the visual issue.",
            "Check if the issue reproduces across different viewport sizes.",
          ],
        },
      });
    }
  }

  const pageDescription = buildPageDescription(analysis);

  return { findings, evidence, pageDescription };
}

function buildPageDescription(analysis: VisionPageAnalysis): string {
  const parts: string[] = [];

  if (analysis.layoutDescription) {
    parts.push(analysis.layoutDescription);
  }

  if (analysis.components.length > 0) {
    parts.push(
      `Visible components: ${analysis.components.slice(0, 10).join(", ")}`,
    );
  }

  return parts.join("\n");
}
