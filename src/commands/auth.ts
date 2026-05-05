// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LoadedDramaturgeConfig, DramaturgeConfig } from '../config.js';
import { captureAuthStateViaUserConfirmation } from '../auth/auth-state-capture.js';

export interface AuthCommandDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
  prompt: (question: string) => Promise<string>;
  confirm: (question: string, defaultValue?: boolean) => Promise<boolean>;
  loadConfig: (configPath?: string) => LoadedDramaturgeConfig;
  captureAuthState?: typeof captureAuthStateViaUserConfirmation;
}

export interface RunAuthCommandArgs {
  subcommand?: string;
  configPath?: string;
  profile?: string;
  url?: string;
}

export async function runAuthCommand(
  args: RunAuthCommandArgs,
  deps: AuthCommandDependencies
): Promise<number> {
  const subcommand = args.subcommand;
  if (!subcommand) {
    deps.error('Missing auth subcommand. Use: dramaturge auth capture | dramaturge auth list');
    return 1;
  }

  if (subcommand === 'list') {
    return runAuthList(deps);
  }

  if (subcommand === 'capture') {
    return runAuthCapture(args, deps);
  }

  deps.error(`Unknown auth subcommand: ${subcommand}. Use: capture | list`);
  return 1;
}

async function runAuthCapture(
  args: RunAuthCommandArgs,
  deps: AuthCommandDependencies
): Promise<number> {
  const captureAuthState = deps.captureAuthState ?? captureAuthStateViaUserConfirmation;
  const profile = sanitizeProfileName(args.profile);

  let loginUrl: string;
  if (args.url) {
    loginUrl = args.url;
  } else {
    const loaded = deps.loadConfig(args.configPath);
    loginUrl = getLoginUrlFromConfig(loaded);
  }

  try {
    new URL(loginUrl);
  } catch {
    deps.error(`Invalid login URL: ${loginUrl}`);
    return 1;
  }

  const outputPath = resolve(deps.cwd, '.dramaturge-state', `${profile}.json`);
  const result = await captureAuthState(
    {
      loginUrl,
      outputPath,
    },
    {
      log: deps.log,
      error: deps.error,
      prompt: deps.prompt,
      confirm: deps.confirm,
    }
  );

  if (!result.confirmed) {
    deps.log('Auth capture canceled (login not confirmed).');
    return 1;
  }

  deps.log(`Saved auth profile "${profile}" to ${outputPath}`);
  deps.log('Next: set config auth type to "stored-state" and point it at the saved file.');
  return 0;
}

function runAuthList(deps: AuthCommandDependencies): number {
  const stateDir = resolve(deps.cwd, '.dramaturge-state');
  if (!existsSync(stateDir)) {
    deps.log('No saved auth profiles found.');
    return 0;
  }

  const profiles = readdirSync(stateDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b));

  if (profiles.length === 0) {
    deps.log('No saved auth profiles found.');
    return 0;
  }

  deps.log('Saved auth profiles:');
  for (const profile of profiles) {
    deps.log(`  ${profile}`);
  }
  return 0;
}

function sanitizeProfileName(profile: string | undefined): string {
  const raw = profile?.trim() ?? '';
  if (raw === '') return 'user';

  const sanitized = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^[-_]+|[-_]+$/g, '');

  return sanitized === '' ? 'user' : sanitized;
}

function getLoginUrlFromConfig(config: DramaturgeConfig): string {
  switch (config.auth.type) {
    case 'none':
      return config.targetUrl;
    case 'stored-state':
      return config.targetUrl;
    case 'form':
      return config.auth.loginUrl;
    case 'oauth-redirect':
      return config.auth.loginUrl;
    case 'interactive':
      return config.auth.loginUrl;
  }
}
