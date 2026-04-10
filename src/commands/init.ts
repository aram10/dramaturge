// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type InitTemplate = 'minimal' | 'full';

export interface InitArgs {
  template: InitTemplate;
  targetUrl?: string;
  outputPath?: string;
}

export interface InitDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
}

function buildMinimalConfig(targetUrl: string): string {
  return JSON.stringify(
    {
      targetUrl,
      appDescription: 'Describe your app: what it does and its main features.',
      auth: { type: 'none' },
      models: {
        planner: 'anthropic/claude-sonnet-4-6',
        worker: 'anthropic/claude-haiku-4-5',
        agentMode: 'cua',
      },
      output: {
        dir: './dramaturge-reports',
        format: 'markdown',
        screenshots: true,
      },
      browser: {
        headless: false,
      },
    },
    null,
    2
  );
}

function buildFullConfig(targetUrl: string): string {
  return JSON.stringify(
    {
      targetUrl,
      appDescription: 'Describe your app: what it does, its main features, and user roles.',
      auth: {
        type: 'interactive',
        loginUrl: '/login',
        successIndicator: "selector:[data-testid='user-menu']",
        stateFile: './.dramaturge-state/user.json',
        manualTimeoutSeconds: 120,
      },
      models: {
        planner: 'anthropic/claude-sonnet-4-6',
        worker: 'anthropic/claude-haiku-4-5',
        agentMode: 'cua',
        agentModes: {
          navigation: 'dom',
          form: 'dom',
          crud: 'cua',
        },
      },
      mission: {
        criticalFlows: [
          'Create a new record',
          'Edit an existing record',
          'Search and filter the list',
        ],
        destructiveActionsAllowed: false,
        focusModes: ['navigation', 'form', 'crud', 'api'],
      },
      apiTesting: {
        enabled: true,
        maxEndpointsPerNode: 4,
        maxProbeCasesPerEndpoint: 6,
        unauthenticatedProbes: true,
        allowMutatingProbes: false,
      },
      adversarial: {
        enabled: false,
        maxSequencesPerNode: 3,
        safeMode: true,
        includeAuthzProbes: false,
        includeConcurrencyProbes: false,
      },
      judge: {
        enabled: true,
        requestTimeoutMs: 15000,
      },
      budget: {
        globalTimeLimitSeconds: 900,
        maxStepsPerTask: 40,
        maxFrontierSize: 200,
        maxStateNodes: 50,
      },
      exploration: {
        maxAreasToExplore: 10,
        stepsPerArea: 40,
        totalTimeout: 900,
      },
      output: {
        dir: './dramaturge-reports',
        format: 'markdown',
        screenshots: true,
      },
      memory: {
        enabled: true,
        dir: './.dramaturge',
        warmStart: true,
      },
      visualRegression: {
        enabled: false,
        baselineDir: './.dramaturge/visual-baselines',
        diffPixelRatioThreshold: 0.01,
        maskSelectors: [],
      },
      browser: {
        headless: false,
      },
      llm: {
        requestTimeoutMs: 30000,
      },
    },
    null,
    2
  );
}

/**
 * Generate a config file from a template.
 * Returns 0 on success, 1 on error.
 */
export function runInit(args: InitArgs, deps: InitDependencies): number {
  const targetUrl = args.targetUrl ?? 'https://your-app.example.com';
  const outputFile = args.outputPath ?? resolve(deps.cwd, 'dramaturge.config.json');

  if (existsSync(outputFile)) {
    deps.error(`Config file already exists: ${outputFile}`);
    deps.error('Remove it first or specify a different path with --output.');
    return 1;
  }

  const content =
    args.template === 'full' ? buildFullConfig(targetUrl) : buildMinimalConfig(targetUrl);

  writeFileSync(outputFile, content + '\n');
  deps.log(`Created ${args.template} config: ${outputFile}`);

  if (args.template === 'minimal') {
    deps.log('\nNext steps:');
    deps.log('  1. Edit the config to set your targetUrl and appDescription');
    deps.log('  2. Set your API key: export ANTHROPIC_API_KEY=sk-...');
    deps.log('  3. Run: dramaturge run');
    deps.log('\nOr skip the config and run directly:');
    deps.log('  dramaturge run https://your-app.example.com');
  }

  return 0;
}
