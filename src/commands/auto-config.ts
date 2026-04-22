// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { detectFramework, scanRepository } from '../adaptation/repo-scan.js';
import { ConfigSchema } from '../config.js';
import { detectProviderFromEnv, hasConfiguredProvider, sendChatCompletion } from '../llm/index.js';
import { UNTRUSTED_PROMPT_INSTRUCTION, wrapUntrustedPromptContent } from '../prompt-safety.js';
import type { RepoFramework, RepoHints } from '../adaptation/types.js';
import type { ProviderId } from '../llm/index.js';

type ConfidenceLevel = 'high' | 'medium' | 'low';
type FocusMode = 'navigation' | 'form' | 'crud' | 'api' | 'adversarial';

const FocusModeSchema = z.enum(['navigation', 'form', 'crud', 'api', 'adversarial']);
const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
const InferredFieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    confidence: ConfidenceSchema,
    rationale: z.string().optional(),
  });

const InferredAutoConfigSchema = z.object({
  appDescription: InferredFieldSchema(z.string().min(1)).optional(),
  requiresLogin: InferredFieldSchema(z.boolean()).optional(),
  loginPath: InferredFieldSchema(z.string().min(1)).optional(),
  criticalFlows: InferredFieldSchema(z.array(z.string().min(1)).max(5)).optional(),
  focusModes: InferredFieldSchema(z.array(FocusModeSchema).max(5)).optional(),
  enableApiTesting: InferredFieldSchema(z.boolean()).optional(),
  enableAdversarial: InferredFieldSchema(z.boolean()).optional(),
});

type InferredAutoConfig = z.infer<typeof InferredAutoConfigSchema>;

const FRAMEWORK_LABELS: Record<RepoFramework, string> = {
  auto: 'auto-detect',
  nextjs: 'Next.js',
  nuxt: 'Nuxt',
  sveltekit: 'SvelteKit',
  remix: 'Remix',
  astro: 'Astro',
  'react-router': 'React Router',
  express: 'Express',
  'vue-router': 'Vue Router',
  django: 'Django',
  fastapi: 'FastAPI',
  rails: 'Rails',
  'tanstack-router': 'TanStack Router',
  generic: 'generic',
};

export interface AutoConfigArgs {
  repoPath?: string | false;
  targetUrl?: string;
  outputPath?: string;
}

export interface RepoScanResult {
  root: string;
  framework: RepoFramework;
  hints: RepoHints;
}

export interface AutoConfigDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
  prompt: (question: string) => Promise<string>;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  select: (question: string, options: string[]) => Promise<string>;
  scanRepo?: (root: string) => RepoScanResult;
  sendChatCompletion?: typeof sendChatCompletion;
}

interface AutoConfigAnswers {
  targetUrl: string;
  appDescription: string;
  requiresLogin: boolean;
  loginUrl?: string;
  criticalFlows: string[];
  focusModes: FocusMode[];
  headless: boolean;
  enableApiTesting: boolean;
  enableAdversarial: boolean;
}

function defaultScan(root: string): RepoScanResult {
  const framework = detectFramework(root);
  const hints = scanRepository({ root, framework });
  return { root, framework, hints };
}

function findGitRoot(dir: string): string | null {
  let current = resolve(dir);
  while (true) {
    if (existsSync(resolve(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function hintsAreMeaningful(hints: RepoHints): boolean {
  return (
    hints.routes.length > 0 ||
    hints.routeFamilies.length > 0 ||
    hints.stableSelectors.length > 0 ||
    hints.apiEndpoints.length > 0 ||
    hints.authHints.loginRoutes.length > 0 ||
    hints.authHints.callbackRoutes.length > 0 ||
    hints.expectedHttpNoise.length > 0
  );
}

function reportScan(log: (message: string) => void, scan: RepoScanResult): void {
  log(`\nScanning repo at ${scan.root}`);
  log(`  framework: ${FRAMEWORK_LABELS[scan.framework]}`);
  log(`  routes detected: ${scan.hints.routes.length}`);
  log(`  route families: ${scan.hints.routeFamilies.length}`);
  log(`  API endpoints: ${scan.hints.apiEndpoints.length}`);
  log(`  login routes: ${scan.hints.authHints.loginRoutes.length}`);
  log(`  callback routes: ${scan.hints.authHints.callbackRoutes.length}`);
  log('');
}

function toRelativeRoot(cwd: string, root: string): string {
  if (root === cwd) return '.';
  const rel = relative(cwd, root);
  return rel || '.';
}

function resolveProviderModels(provider: ProviderId): { planner: string; worker: string } {
  switch (provider) {
    case 'anthropic':
      return {
        planner: 'anthropic/claude-sonnet-4-6',
        worker: 'anthropic/claude-haiku-4-5',
      };
    case 'openai':
      return { planner: 'openai/gpt-4.1', worker: 'openai/gpt-4.1-mini' };
    case 'google':
      return { planner: 'google/gemini-2.5-pro', worker: 'google/gemini-2.5-flash' };
    case 'azure':
      return { planner: 'azure/gpt-4.1', worker: 'azure/gpt-4.1-mini' };
    case 'openrouter':
      return {
        planner: 'openrouter/anthropic/claude-sonnet-4-6',
        worker: 'openrouter/anthropic/claude-haiku-4-5',
      };
    case 'github':
      return { planner: 'github/openai/gpt-4.1', worker: 'github/openai/gpt-4.1-mini' };
    case 'ollama':
      return {
        planner: process.env.OLLAMA_PLANNER_MODEL
          ? `ollama/${process.env.OLLAMA_PLANNER_MODEL}`
          : 'ollama/llama3.1:70b',
        worker: process.env.OLLAMA_WORKER_MODEL
          ? `ollama/${process.env.OLLAMA_WORKER_MODEL}`
          : 'ollama/llama3.1:8b',
      };
    case 'custom': {
      const plannerModel = process.env.OPENAI_COMPATIBLE_PLANNER_MODEL?.trim();
      const workerModel = process.env.OPENAI_COMPATIBLE_WORKER_MODEL?.trim();
      if (!plannerModel || !workerModel) {
        throw new Error(
          'Custom provider requires OPENAI_COMPATIBLE_PLANNER_MODEL and OPENAI_COMPATIBLE_WORKER_MODEL.'
        );
      }
      return {
        planner: `custom/${plannerModel}`,
        worker: `custom/${workerModel}`,
      };
    }
  }
}

function resolveScanRoot(deps: AutoConfigDependencies, repoPath?: string | false): string | null {
  if (repoPath === false) return null;
  if (typeof repoPath === 'string' && repoPath.length > 0) {
    return isAbsolute(repoPath) ? repoPath : resolve(deps.cwd, repoPath);
  }
  return findGitRoot(deps.cwd) ?? deps.cwd;
}

async function maybeRunRepoScan(
  deps: AutoConfigDependencies,
  args: AutoConfigArgs
): Promise<RepoScanResult | null> {
  const root = resolveScanRoot(deps, args.repoPath);
  if (!root) return null;
  if (!existsSync(root)) {
    deps.error(`Repo path not found: ${root}`);
    return null;
  }
  try {
    if (!statSync(root).isDirectory()) {
      deps.error(`Repo path is not a directory: ${root}`);
      return null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Invalid repo path: ${root} (${message})`);
    return null;
  }

  const scanFn = deps.scanRepo ?? defaultScan;
  try {
    const result = scanFn(root);
    reportScan(deps.log, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Repo scan failed: ${message}`);
    return null;
  }
}

function readOptionalTextFile(path: string, maxChars: number): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8').slice(0, maxChars);
  } catch {
    return null;
  }
}

function readPackageSummary(root: string): string | null {
  const raw = readOptionalTextFile(resolve(root, 'package.json'), 8_000);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scripts =
      parsed.scripts && typeof parsed.scripts === 'object'
        ? Object.keys(parsed.scripts as Record<string, unknown>).sort()
        : [];
    return JSON.stringify(
      {
        name: parsed.name,
        description: parsed.description,
        packageManager: parsed.packageManager,
        scripts,
        dependencies:
          parsed.dependencies && typeof parsed.dependencies === 'object'
            ? Object.keys(parsed.dependencies as Record<string, unknown>)
                .sort()
                .slice(0, 25)
            : [],
      },
      null,
      2
    );
  } catch {
    return raw;
  }
}

function collectRepoSummary(scan: RepoScanResult | null): string {
  if (!scan) {
    return 'No repository scan data was available.';
  }

  const sections = [
    `Framework: ${scan.framework}`,
    `Routes (${scan.hints.routes.length}): ${scan.hints.routes.slice(0, 25).join(', ') || 'none'}`,
    `Route families (${scan.hints.routeFamilies.length}): ${
      scan.hints.routeFamilies.slice(0, 15).join(', ') || 'none'
    }`,
    `Stable selectors (${scan.hints.stableSelectors.length}): ${
      scan.hints.stableSelectors.slice(0, 15).join(', ') || 'none'
    }`,
    `API endpoints (${scan.hints.apiEndpoints.length}): ${
      scan.hints.apiEndpoints
        .slice(0, 15)
        .map((endpoint) => `${endpoint.methods.join('/')} ${endpoint.route}`)
        .join(', ') || 'none'
    }`,
    `Login routes: ${scan.hints.authHints.loginRoutes.join(', ') || 'none'}`,
    `Callback routes: ${scan.hints.authHints.callbackRoutes.join(', ') || 'none'}`,
  ];

  const packageSummary = readPackageSummary(scan.root);
  if (packageSummary) {
    sections.push(`package.json summary:\n${packageSummary}`);
  }

  const readme =
    readOptionalTextFile(resolve(scan.root, 'README.md'), 6_000) ??
    readOptionalTextFile(resolve(scan.root, 'README'), 6_000) ??
    readOptionalTextFile(resolve(scan.root, 'readme.md'), 6_000);
  if (readme) {
    sections.push(`README excerpt:\n${readme}`);
  }

  const pyproject = readOptionalTextFile(resolve(scan.root, 'pyproject.toml'), 4_000);
  if (pyproject) {
    sections.push(`pyproject.toml excerpt:\n${pyproject}`);
  }

  return sections.join('\n\n');
}

function extractJsonFromResponse(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return fenceMatch ? fenceMatch[1].trim() : raw.trim();
}

async function inferConfigFromRepo(
  deps: AutoConfigDependencies,
  scan: RepoScanResult | null,
  model: string
): Promise<InferredAutoConfig> {
  if (!scan) {
    return {};
  }

  const repoSummary = collectRepoSummary(scan);
  const system = `You infer Dramaturge configuration fields from repository evidence.
Return ONLY JSON with any subset of these fields:
{
  "appDescription": { "value": string, "confidence": "high" | "medium" | "low" },
  "requiresLogin": { "value": boolean, "confidence": "high" | "medium" | "low" },
  "loginPath": { "value": string, "confidence": "high" | "medium" | "low" },
  "criticalFlows": { "value": string[], "confidence": "high" | "medium" | "low" },
  "focusModes": { "value": ("navigation" | "form" | "crud" | "api" | "adversarial")[], "confidence": "high" | "medium" | "low" },
  "enableApiTesting": { "value": boolean, "confidence": "high" | "medium" | "low" },
  "enableAdversarial": { "value": boolean, "confidence": "high" | "medium" | "low" }
}

Rules:
- Infer only what the evidence supports.
- Use "low" confidence whenever you are unsure.
- Never invent secrets, credentials, or deployed URLs.
- Prefer login paths like "/login" instead of absolute URLs.
- Keep appDescription to one or two concise sentences.
- Keep criticalFlows to at most five concise items.
- Recommend adversarial testing only when the repo strongly suggests security-sensitive workflows or APIs.`;

  const prompt = `${UNTRUSTED_PROMPT_INSTRUCTION}

${wrapUntrustedPromptContent('REPO SUMMARY', repoSummary)}`;

  try {
    const raw = await (deps.sendChatCompletion ?? sendChatCompletion)({
      model,
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1_200,
      requestTimeoutMs: 30_000,
    });
    const parsed = JSON.parse(extractJsonFromResponse(raw)) as unknown;
    const result = InferredAutoConfigSchema.safeParse(parsed);
    if (!result.success) {
      deps.log('LLM auto-config inference returned invalid JSON; falling back to prompts.');
      return {};
    }
    return result.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log(`LLM auto-config inference failed; falling back to prompts. (${message})`);
    return {};
  }
}

function isConfident(level: ConfidenceLevel | undefined): boolean {
  return level === 'high';
}

function getSuggestedString(
  field: InferredAutoConfig['appDescription'] | InferredAutoConfig['loginPath'] | undefined
): string | undefined {
  return field?.confidence === 'medium' ? field.value : undefined;
}

function getSuggestedBoolean(
  field:
    | InferredAutoConfig['requiresLogin']
    | InferredAutoConfig['enableApiTesting']
    | InferredAutoConfig['enableAdversarial']
    | undefined
): boolean | undefined {
  return field?.confidence === 'medium' ? field.value : undefined;
}

function getSuggestedStringList(
  field: InferredAutoConfig['criticalFlows'] | InferredAutoConfig['focusModes'] | undefined
): string[] {
  if (field?.confidence === 'medium') {
    return [...field.value];
  }
  return [];
}

async function resolveTargetUrl(
  deps: AutoConfigDependencies,
  targetUrl: string | undefined
): Promise<string | null> {
  const value = targetUrl ?? (await deps.prompt('What URL should I test?'));
  if (!value) {
    deps.error('A target URL is required.');
    return null;
  }
  try {
    return new URL(value).toString();
  } catch {
    deps.error(`Invalid URL: ${value}`);
    return null;
  }
}

async function promptWithSuggestion(
  deps: AutoConfigDependencies,
  question: string,
  suggestion?: string
): Promise<string> {
  const suffix = suggestion ? ` [press enter to accept: ${suggestion}]` : '';
  const answer = await deps.prompt(`${question}${suffix}`);
  return answer || suggestion || '';
}

async function resolveAppDescription(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig,
  targetUrl: string
): Promise<string> {
  if (isConfident(inferred.appDescription?.confidence)) {
    return inferred.appDescription!.value;
  }
  const description = await promptWithSuggestion(
    deps,
    'Describe the app',
    getSuggestedString(inferred.appDescription)
  );
  return description || `Web application at ${new URL(targetUrl).hostname}`;
}

async function resolveRequiresLogin(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig,
  scan: RepoScanResult | null
): Promise<boolean> {
  if (isConfident(inferred.requiresLogin?.confidence)) {
    return inferred.requiresLogin!.value;
  }
  const defaultValue =
    getSuggestedBoolean(inferred.requiresLogin) ?? Boolean(scan?.hints.authHints.loginRoutes[0]);
  return deps.confirm('Does the app require login?', defaultValue);
}

function normalizeLoginUrl(targetUrl: string, loginPath: string): string {
  try {
    return new URL(loginPath, targetUrl).toString();
  } catch {
    return targetUrl;
  }
}

async function resolveLoginUrl(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig,
  scan: RepoScanResult | null,
  targetUrl: string
): Promise<string> {
  const confidentLoginPath = isConfident(inferred.loginPath?.confidence)
    ? inferred.loginPath?.value
    : undefined;
  const suggestedPath =
    confidentLoginPath ??
    getSuggestedString(inferred.loginPath) ??
    scan?.hints.authHints.loginRoutes[0] ??
    '/login';
  const loginPath = await promptWithSuggestion(
    deps,
    'What login path or URL should Dramaturge use?',
    suggestedPath
  );
  return normalizeLoginUrl(targetUrl, loginPath || targetUrl);
}

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function resolveCriticalFlows(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig
): Promise<string[]> {
  if (isConfident(inferred.criticalFlows?.confidence)) {
    return inferred.criticalFlows!.value;
  }
  const suggestion = getSuggestedStringList(inferred.criticalFlows).join(', ');
  const answer = await promptWithSuggestion(
    deps,
    'Critical flows to prioritize (comma-separated, optional)',
    suggestion || undefined
  );
  return parseCommaSeparatedValues(answer);
}

function parseFocusModes(value: string): FocusMode[] | null {
  const raw = parseCommaSeparatedValues(value);
  if (raw.length === 0) {
    return [];
  }
  const unique = [...new Set(raw)];
  const parsed = z.array(FocusModeSchema).safeParse(unique);
  return parsed.success ? parsed.data : null;
}

async function resolveFocusModes(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig
): Promise<FocusMode[]> {
  if (isConfident(inferred.focusModes?.confidence)) {
    return inferred.focusModes!.value;
  }

  const suggested = getSuggestedStringList(inferred.focusModes);
  while (true) {
    const answer = await promptWithSuggestion(
      deps,
      'Focus modes (comma-separated: navigation, form, crud, api, adversarial; optional)',
      suggested.join(', ') || undefined
    );
    const parsed = parseFocusModes(answer);
    if (parsed !== null) {
      return parsed;
    }
    deps.error('Invalid focus modes. Use only: navigation, form, crud, api, adversarial.');
  }
}

async function resolveApiTesting(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig,
  scan: RepoScanResult | null
): Promise<boolean> {
  if (isConfident(inferred.enableApiTesting?.confidence)) {
    return inferred.enableApiTesting!.value;
  }
  const defaultValue =
    getSuggestedBoolean(inferred.enableApiTesting) ?? Boolean(scan?.hints.apiEndpoints.length);
  return deps.confirm('Enable API contract testing?', defaultValue);
}

async function resolveAdversarial(
  deps: AutoConfigDependencies,
  inferred: InferredAutoConfig
): Promise<boolean> {
  if (isConfident(inferred.enableAdversarial?.confidence)) {
    return inferred.enableAdversarial!.value;
  }
  return deps.confirm(
    'Enable adversarial security probes?',
    getSuggestedBoolean(inferred.enableAdversarial) ?? false
  );
}

async function collectAnswers(
  deps: AutoConfigDependencies,
  args: AutoConfigArgs,
  inferred: InferredAutoConfig,
  scan: RepoScanResult | null
): Promise<AutoConfigAnswers | null> {
  const targetUrl = await resolveTargetUrl(deps, args.targetUrl);
  if (!targetUrl) {
    return null;
  }

  const appDescription = await resolveAppDescription(deps, inferred, targetUrl);
  const requiresLogin = await resolveRequiresLogin(deps, inferred, scan);
  const loginUrl = requiresLogin
    ? await resolveLoginUrl(deps, inferred, scan, targetUrl)
    : undefined;
  const criticalFlows = await resolveCriticalFlows(deps, inferred);
  const focusModes = await resolveFocusModes(deps, inferred);
  const enableApiTesting = await resolveApiTesting(deps, inferred, scan);
  const enableAdversarial = enableApiTesting ? await resolveAdversarial(deps, inferred) : false;
  const headless = await deps.confirm('Run browser in headless mode?', false);

  return {
    targetUrl,
    appDescription,
    requiresLogin,
    loginUrl,
    criticalFlows,
    focusModes,
    headless,
    enableApiTesting,
    enableAdversarial,
  };
}

function shouldRecordRepoContext(scan: RepoScanResult | null): boolean {
  if (!scan) return false;
  return hintsAreMeaningful(scan.hints) || scan.framework !== 'generic';
}

function buildConfig(
  deps: AutoConfigDependencies,
  answers: AutoConfigAnswers,
  scan: RepoScanResult | null,
  provider: ProviderId
): Record<string, unknown> {
  const models = resolveProviderModels(provider);
  const config: Record<string, unknown> = {
    targetUrl: answers.targetUrl,
    appDescription: answers.appDescription,
    auth: answers.requiresLogin
      ? {
          type: 'interactive',
          loginUrl: answers.loginUrl ?? answers.targetUrl,
          successIndicator: `url:${new URL(answers.targetUrl).origin}`,
          stateFile: './.dramaturge-state/user.json',
          manualTimeoutSeconds: 120,
        }
      : { type: 'none' },
    models: {
      planner: models.planner,
      worker: models.worker,
      agentMode: 'cua',
    },
    output: {
      dir: './dramaturge-reports',
      format: 'markdown',
      screenshots: true,
    },
    browser: {
      headless: answers.headless,
    },
  };

  if (answers.criticalFlows.length > 0 || answers.focusModes.length > 0) {
    config.mission = {
      ...(answers.criticalFlows.length > 0 ? { criticalFlows: answers.criticalFlows } : {}),
      ...(answers.focusModes.length > 0 ? { focusModes: answers.focusModes } : {}),
      destructiveActionsAllowed: false,
    };
  }

  if (shouldRecordRepoContext(scan)) {
    config.repoContext = {
      root: toRelativeRoot(deps.cwd, scan!.root),
      framework: scan!.framework,
    };
  }

  if (answers.enableApiTesting) {
    config.apiTesting = { enabled: true };
  }
  if (answers.enableAdversarial) {
    config.adversarial = { enabled: true };
  }

  ConfigSchema.parse(config);
  return config;
}

async function writeConfigFile(
  deps: AutoConfigDependencies,
  outputPath: string | undefined,
  config: Record<string, unknown>
): Promise<void> {
  const configPath = outputPath
    ? resolve(deps.cwd, outputPath)
    : resolve(deps.cwd, 'dramaturge.config.json');
  if (existsSync(configPath)) {
    const overwrite = await deps.confirm(`${configPath} already exists. Overwrite?`, false);
    if (!overwrite) {
      deps.log('Skipping config write.');
      return;
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  deps.log(`\nWrote ${configPath}`);
}

export async function runAutoConfig(
  deps: AutoConfigDependencies,
  args: AutoConfigArgs = {}
): Promise<number> {
  deps.log('Welcome to Dramaturge Auto Config!\n');
  deps.log('Dramaturge will inspect your repo, infer what it can, and ask only for the gaps.\n');

  if (!hasConfiguredProvider()) {
    deps.error(
      'No LLM API key detected. Export a supported provider key before running auto-config.'
    );
    return 1;
  }

  const provider = detectProviderFromEnv();
  const scan = await maybeRunRepoScan(deps, args);
  const inferred = await inferConfigFromRepo(deps, scan, resolveProviderModels(provider).planner);
  const answers = await collectAnswers(deps, args, inferred, scan);
  if (!answers) {
    return 1;
  }

  const config = buildConfig(deps, answers, scan, provider);
  await writeConfigFile(deps, args.outputPath, config);

  deps.log('\n─── Auto config complete! ───\n');
  deps.log('Next steps:');
  deps.log(`  dramaturge run --config ${args.outputPath ?? 'dramaturge.config.json'}`);
  deps.log('  dramaturge doctor');
  deps.log('');
  return 0;
}
