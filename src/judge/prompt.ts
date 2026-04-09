import type { Observation, TraceBundle } from './types.js';
import { UNTRUSTED_PROMPT_INSTRUCTION, wrapUntrustedPromptContent } from '../prompt-safety.js';

export function buildJudgePrompt(observation: Observation, bundle: TraceBundle): string {
  const observationSummary = `Observation title: ${observation.title}
Expected: ${observation.expected}
Actual: ${observation.actual}
Steps:
${observation.stepsToReproduce.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;

  const traceSummary = bundle.summary.join('\n');

  return `Judge this QA observation and return a concise verdict.

${UNTRUSTED_PROMPT_INSTRUCTION}

${wrapUntrustedPromptContent('OBSERVATION DETAILS', observationSummary)}

Trace bundle:
${wrapUntrustedPromptContent('TRACE BUNDLE', traceSummary)}

Return a verdict that states:
- a hypothesis phrased with "should"
- a concise observation
- alternative explanations
- a suggested verification step`;
}
