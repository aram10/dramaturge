// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { detectFramework, scanRepository } from '../adaptation/repo-scan.js';
import type { RepoFramework, RepoHints } from '../adaptation/types.js';

export interface SetupAnswers {
  targetUrl: string;
  appDescription: string;
  requiresLogin: boolean;
  provider: 'anthropic' | 'openai' | 'google' | 'azure' | 'openrouter' | 'github';
  apiKey: string;
  headless: boolean;
  saveConfig: boolean;
}

export interface SetupArgs {
  /**
   * Path to scan for repo-aware bootstrap. Relative paths resolve against cwd.
   * When omitted, runSetup auto-detects by walking upward from cwd to find a `.git` marker.
   * Pass `false` to disable scanning entirely.
   */
  repoPath?: string | false;
}

export interface RepoScanResult {
  root: string;
  framework: RepoFramework;
  hints: RepoHints;
}

export interface SetupDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
  prompt: (question: string) => Promise<string>;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  select: (question: string, options: string[]) => Promise<string>;
  /**
   * Scanner override for tests. Defaults to detecting the framework for the
   * provided root and then calling scanRepository({ root, framework }).
   */
  scanRepo?: (root: string) => RepoScanResult;
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  azure: 'AZURE_AI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  github: 'GITHUB_TOKEN',
};

const PROVIDER_MODELS: Record<string, { planner: string; worker: string }> = {
  anthropic: {
    planner: 'anthropic/claude-sonnet-4-6',
    worker: 'anthropic/claude-haiku-4-5',
  },
  openai: {
    planner: 'openai/gpt-4.1',
    worker: 'openai/gpt-4.1-mini',
  },
  google: {
    planner: 'google/gemini-2.5-pro',
    worker: 'google/gemini-2.5-flash',
  },
  azure: {
    planner: 'azure/gpt-4.1',
    worker: 'azure/gpt-4.1-mini',
  },
  openrouter: {
    planner: 'openrouter/anthropic/claude-sonnet-4-6',
    worker: 'openrouter/anthropic/claude-haiku-4-5',
  },
  github: {
    planner: 'github/openai/gpt-4.1',
    worker: 'github/openai/gpt-4.1-mini',
  },
};

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

function defaultScan(root: string): RepoScanResult {
  const framework = detectFramework(root);
  const hints = scanRepository({ root, framework });
  return { root, framework, hints };
}

/**
 * Walk upward from `dir` looking for a `.git` marker. Returns the directory that
 * contains `.git`, or null if none is found before reaching the filesystem root.
 */
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

/**
 * Run the interactive setup wizard.
 * Collects user answers and writes config + optional .env.
 */
export async function runSetup(deps: SetupDependencies, args: SetupArgs = {}): Promise<number> {
  deps.log('Welcome to Dramaturge Setup!\n');
  deps.log('This wizard will create a config file and get you ready to run.\n');

  // 0. Repo scan (optional, auto-detects when inside a git repo)
  const scan = await maybeRunRepoScan(deps, args);

  // 1. Target URL
  const targetUrl = await deps.prompt('What URL should I test?');
  if (!targetUrl) {
    deps.error('A target URL is required.');
    return 1;
  }

  try {
    new URL(targetUrl);
  } catch {
    deps.error(`Invalid URL: ${targetUrl}`);
    return 1;
  }

  // 2. App description
  const appDescription = await deps.prompt(
    'Briefly describe the app (e.g., "E-commerce platform with user accounts")'
  );

  // 3. Auth
  const detectedLoginRoute = scan?.hints.authHints.loginRoutes[0];
  if (detectedLoginRoute) {
    deps.log(`  (Detected possible login route: ${detectedLoginRoute})`);
  }
  const requiresLogin = await deps.confirm(
    'Does the app require login?',
    Boolean(detectedLoginRoute)
  );

  // 4-5. Provider + API key
  const { providerKey, envKey, apiKey } = await selectProvider(deps);

  // 6. Headless
  const headless = await deps.confirm('Run browser in headless mode?', false);

  // 7. Feature toggles suggested by the repo scan
  let enableApiTesting = false;
  let enableAdversarial = false;
  if (scan !== null) {
    if (scan.hints.apiEndpoints.length > 0) {
      enableApiTesting = await deps.confirm(
        `Enable API contract testing? (${scan.hints.apiEndpoints.length} endpoint(s) detected)`,
        true
      );
      enableAdversarial = await deps.confirm(
        'Enable adversarial security probes against detected API endpoints?',
        false
      );
    }
  }

  // 8. Save config
  const saveConfig = await deps.confirm('Save config to dramaturge.config.json?', true);

  // Build config
  const models = PROVIDER_MODELS[providerKey];
  const detectedLoginPath = scan?.hints.authHints.loginRoutes[0];
  const loginUrl =
    requiresLogin && detectedLoginPath
      ? new URL(detectedLoginPath, targetUrl).toString()
      : targetUrl;
  const successIndicator = `url:${new URL(targetUrl).origin}`;

  const config: Record<string, unknown> = {
    targetUrl,
    appDescription: appDescription || `Web application at ${new URL(targetUrl).hostname}`,
    auth: requiresLogin
      ? {
          type: 'interactive',
          loginUrl,
          successIndicator,
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
      headless,
    },
  };

  if (scan !== null) {
    const relRoot = toRelativeRoot(deps.cwd, scan.root);
    config.repoContext = {
      root: relRoot,
      framework: scan.framework,
    };
  }

  if (enableApiTesting) {
    config.apiTesting = { enabled: true };
  }
  if (enableAdversarial) {
    config.adversarial = { enabled: true };
  }

  if (saveConfig) {
    await writeConfigFile(deps, config);
  }
  if (apiKey) {
    await writeEnvFile(deps, envKey, apiKey);
  }

  // Next steps
  deps.log('\n─── Setup complete! ───\n');
  deps.log('Next steps:');
  if (saveConfig) {
    deps.log('  dramaturge run              # run with saved config');
  } else {
    deps.log(`  dramaturge run ${targetUrl}`);
  }
  if (requiresLogin) {
    deps.log('  (A browser will open for you to sign in on first run.)');
  }
  deps.log('  dramaturge doctor           # verify your environment');
  deps.log('');

  return 0;
}

interface ProviderChoice {
  provider: string;
  providerKey: string;
  envKey: string;
  apiKey: string;
}

async function selectProvider(deps: SetupDependencies): Promise<ProviderChoice> {
  const provider = await deps.select('Which LLM provider do you want to use?', [
    'Anthropic',
    'OpenAI',
    'Google',
    'Azure AI Foundry',
    'OpenRouter',
    'GitHub Models',
  ]);
  const providerKeyMap: Record<string, string> = {
    anthropic: 'anthropic',
    openai: 'openai',
    google: 'google',
    'azure ai foundry': 'azure',
    openrouter: 'openrouter',
    'github models': 'github',
  };
  const providerKey = providerKeyMap[provider.toLowerCase()] ?? 'anthropic';
  const envKey = PROVIDER_ENV_KEYS[providerKey];

  let apiKey = '';
  if (!process.env[envKey]) {
    apiKey = await deps.prompt(`Paste your ${provider} API key (${envKey})`);
  } else {
    deps.log(`  ${envKey} is already set in your environment.`);
  }

  return { provider, providerKey, envKey, apiKey };
}

async function writeConfigFile(
  deps: SetupDependencies,
  config: Record<string, unknown>
): Promise<void> {
  const configPath = resolve(deps.cwd, 'dramaturge.config.json');
  if (existsSync(configPath)) {
    const overwrite = await deps.confirm(
      'dramaturge.config.json already exists. Overwrite?',
      false
    );
    if (!overwrite) {
      deps.log('Skipping config write.');
      return;
    }
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  deps.log(`\nWrote ${configPath}`);
}

async function writeEnvFile(
  deps: SetupDependencies,
  envKey: string,
  apiKey: string
): Promise<void> {
  const envPath = resolve(deps.cwd, '.env');
  const envLine = `${envKey}=${apiKey}\n`;

  if (existsSync(envPath)) {
    deps.log(`\nAdd this to your .env:\n  ${envKey}=<your-key>`);
    return;
  }
  const saveEnv = await deps.confirm('Save API key to .env file?', true);
  if (!saveEnv) return;
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, envLine);
  deps.log(`Wrote ${envPath}`);
  deps.log('  (Add .env to your .gitignore!)');
}

async function maybeRunRepoScan(
  deps: SetupDependencies,
  args: SetupArgs
): Promise<RepoScanResult | null> {
  // Explicit opt-out
  if (args.repoPath === false) return null;

  let root: string | undefined;
  if (typeof args.repoPath === 'string' && args.repoPath.length > 0) {
    root = isAbsolute(args.repoPath) ? args.repoPath : resolve(deps.cwd, args.repoPath);
  } else {
    const gitRoot = findGitRoot(deps.cwd);
    if (gitRoot) root = gitRoot;
  }

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.error(`Invalid repo path: ${root} (${message})`);
    return null;
  }

  const scanFn = deps.scanRepo ?? defaultScan;
  let result: RepoScanResult;
  try {
    result = scanFn(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.error(`Repo scan failed: ${message}`);
    return null;
  }

  reportScan(deps.log, result);

  // When no hints were extracted we still keep the result if a concrete framework was detected,
  // so the generated config preserves `repoContext.framework` for the engine to use at runtime.
  if (!hintsAreMeaningful(result.hints)) {
    if (result.framework === 'generic') {
      deps.log('  (No routes or endpoints detected — proceeding with a generic config.)\n');
      return null;
    }
    deps.log(`  (No routes extracted, but framework detected — recording framework only.)\n`);
    return result;
  }

  const useScan = await deps.confirm('Use these detected hints in the generated config?', true);
  if (!useScan) return null;

  return result;
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
  if (!rel) return '.';
  return rel;
}
