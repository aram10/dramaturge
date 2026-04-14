// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { shortId } from '../constants.js';
import { hasLLMApiKey } from '../llm.js';
import { sendVisionCompletion } from '../llm/index.js';
import { UNTRUSTED_PROMPT_INSTRUCTION, wrapUntrustedPromptContent } from '../prompt-safety.js';
import type { Evidence, RawFinding, FindingSeverity, FindingCategory, PageType } from '../types.js';

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

  const pageContext = `${UNTRUSTED_PROMPT_INSTRUCTION}

${wrapUntrustedPromptContent(
  "VISION PAGE CONTEXT",
  `Page URL: ${options.route}\nPage type: ${options.pageType}\nArea: ${options.areaName}\n\nAnalyze this screenshot for layout structure and visual anomalies.`
)}`;

  const raw = await sendVisionCompletion({
    model: options.model,
    system: VISION_SYSTEM_PROMPT,
    base64Image,
    pageContext,
    maxTokens: options.maxResponseTokens,
    requestTimeoutMs: options.requestTimeoutMs,
  });

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
