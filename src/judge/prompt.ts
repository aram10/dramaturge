import type { Observation, TraceBundle } from "./types.js";

export function buildJudgePrompt(
  observation: Observation,
  bundle: TraceBundle
): string {
  return `Judge this QA observation and return a concise verdict.

Observation title: ${observation.title}
Expected: ${observation.expected}
Actual: ${observation.actual}
Steps:
${observation.stepsToReproduce.map((step, index) => `${index + 1}. ${step}`).join("\n")}

Trace bundle:
${bundle.summary.join("\n")}

Return a verdict that states:
- a hypothesis phrased with "should"
- a concise observation
- alternative explanations
- a suggested verification step`;
}
