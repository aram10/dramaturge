// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export interface SetupAnswers {
  targetUrl: string;
  appDescription: string;
  requiresLogin: boolean;
  provider: 'anthropic' | 'openai' | 'google';
  apiKey: string;
  headless: boolean;
  saveConfig: boolean;
}

export interface SetupDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
  prompt: (question: string) => Promise<string>;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  select: (question: string, options: string[]) => Promise<string>;
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
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
};

/**
 * Run the interactive setup wizard.
 * Collects user answers and writes config + optional .env.
 */
export async function runSetup(deps: SetupDependencies): Promise<number> {
  deps.log('Welcome to Dramaturge Setup!\n');
  deps.log('This wizard will create a config file and get you ready to run.\n');

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
  const requiresLogin = await deps.confirm('Does the app require login?', false);

  // 4. Provider
  const provider = await deps.select('Which LLM provider do you want to use?', [
    'Anthropic',
    'OpenAI',
    'Google',
  ]);
  const providerKey = provider.toLowerCase() as 'anthropic' | 'openai' | 'google';

  // 5. API key
  const envKey = PROVIDER_ENV_KEYS[providerKey];
  let apiKey = '';
  if (!process.env[envKey]) {
    apiKey = await deps.prompt(`Paste your ${provider} API key (${envKey})`);
  } else {
    deps.log(`  ${envKey} is already set in your environment.`);
  }

  // 6. Headless
  const headless = await deps.confirm('Run browser in headless mode?', false);

  // 7. Save config
  const saveConfig = await deps.confirm('Save config to dramaturge.config.json?', true);

  // Build config
  const models = PROVIDER_MODELS[providerKey];
  const config: Record<string, unknown> = {
    targetUrl,
    appDescription: appDescription || `Web application at ${new URL(targetUrl).hostname}`,
    auth: requiresLogin
      ? {
          type: 'interactive',
          loginUrl: targetUrl,
          successIndicator: `url:${new URL(targetUrl).origin}`,
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

  // Write config
  if (saveConfig) {
    const configPath = resolve(deps.cwd, 'dramaturge.config.json');
    if (existsSync(configPath)) {
      const overwrite = await deps.confirm(
        'dramaturge.config.json already exists. Overwrite?',
        false
      );
      if (!overwrite) {
        deps.log('Skipping config write.');
      } else {
        writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
        deps.log(`\nWrote ${configPath}`);
      }
    } else {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      deps.log(`\nWrote ${configPath}`);
    }
  }

  // Write .env if API key was provided
  if (apiKey) {
    const envPath = resolve(deps.cwd, '.env');
    const envLine = `${envKey}=${apiKey}\n`;

    if (existsSync(envPath)) {
      deps.log(`\nAdd this to your .env:\n  ${envKey}=<your-key>`);
    } else {
      const saveEnv = await deps.confirm('Save API key to .env file?', true);
      if (saveEnv) {
        mkdirSync(dirname(envPath), { recursive: true });
        writeFileSync(envPath, envLine);
        deps.log(`Wrote ${envPath}`);
        deps.log('  (Add .env to your .gitignore!)');
      }
    }
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
