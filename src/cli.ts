#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { pathToFileURL } from 'node:url';
import { loadConfig, type LoadedDramaturgeConfig, type DramaturgeConfig } from './config.js';
import { resolveResumeDir } from './config-paths.js';
import { runEngine, type RunEngineOptions } from './engine.js';
import { EngineEventEmitter } from './engine/event-stream.js';
import { loadDotenv } from './env.js';
import {
  buildConfigFromArgs,
  FOCUS_MODES,
  PRESET_NAMES,
  type FocusMode,
  type InlineRunArgs,
  type PresetName,
} from './config-inline.js';
import { runDoctor } from './commands/doctor.js';
import { runInit, type InitTemplate } from './commands/init.js';
import { runTriageCommand } from './commands/triage.js';
import type {
  ErrorEvent,
  FindingEvent,
  ProgressEvent,
  StateDiscoveredEvent,
  TaskStartEvent,
  TaskCompleteEvent,
} from './engine/event-stream.js';

export interface ParsedCliArgs {
  command:
    | 'run'
    | 'doctor'
    | 'init'
    | 'setup'
    | 'auto-config'
    | 'findings'
    | 'baselines'
    | 'memory'
    | 'help';
  configPath?: string;
  resumeDir?: string;
  diffRef?: string;
  dashboard: boolean;
  showHelp: boolean;
  /** Positional URL for `run <url>` */
  url?: string;
  /** --login flag for inline runs */
  login?: boolean;
  /** --headless flag for inline runs */
  headless?: boolean;
  /** --provider flag for inline runs */
  provider?: 'anthropic' | 'openai' | 'google' | 'azure' | 'openrouter' | 'github';
  /** --preset flag for inline runs */
  preset?: PresetName;
  /** --focus flags for inline runs (repeatable, comma-separated values allowed) */
  focusModes?: FocusMode[];
  /** --format flag — comma-separated list of report formats */
  formats?: Array<'markdown' | 'json' | 'both' | 'junit' | 'sarif'>;
  /** --template flag for init */
  initTemplate?: InitTemplate;
  /** --output flag for init */
  initOutput?: string;
  /** --repo flag for setup: path to scan for repo-aware bootstrap */
  repoPath?: string;
  /** --no-scan flag for setup: disables repo scan entirely */
  noScan?: true;
  /** Subcommand after findings/baselines/memory (e.g. "list", "suppress") */
  triageSubcommand?: string;
  /** Positional args for triage subcommands */
  triagePositional?: string[];
  /** --suppressed flag for findings list */
  triageSuppressedOnly?: boolean;
  /** --all flag for baselines approve */
  triageAll?: boolean;
  /** --reason <text> for findings suppress */
  triageReason?: string;
}

export interface CliDependencies {
  loadConfig: (configPath?: string) => LoadedDramaturgeConfig;
  runEngine: (config: DramaturgeConfig, options?: RunEngineOptions) => Promise<void>;
  log: (message: string) => void;
  error: (message: string) => void;
}

const HELP_TEXT = `Usage: dramaturge <command> [options]

Commands:
  run [url]            Run exploratory QA (default command)
  setup                Interactive first-run onboarding wizard
  init                 Generate a config file from a template
  auto-config          AI-assisted config generation from repo context
  doctor               Check environment and configuration
  findings <sub>       Triage findings in memory (list | suppress | unsuppress)
  baselines <sub>      Manage visual-regression baselines (list | approve)
  memory stats         Show memory store statistics

Run options:
  --config <path>      Path to config file (default: dramaturge.config.json)
  --resume <run-dir>   Resume a previous run from its output directory
  --diff <base-ref>    Enable diff-aware mode against a git ref (e.g. origin/main)
  --dashboard          Show a real-time terminal dashboard (powered by Ink)
  --login              Enable interactive auth (opens browser for sign-in)
  --headless           Run browser in headless mode
  --provider <name>    LLM provider: anthropic, openai, google, azure, openrouter, or github
  --preset <name>      Preset: smoke, thorough, security, accessibility, api-contract, visual, pre-release
  --focus <modes>      Focus modes (repeatable / comma-separated): navigation, form, crud, api, adversarial
  --format <list>      Report formats, comma-separated: markdown, json, junit, sarif, or both (legacy alias) (e.g. markdown,sarif)
  --help, -h           Show this help message

Init options:
  --template <name>    Template to use: minimal (default) or full
  --url <url>          Pre-fill target URL in generated config
  --output <path>      Output path for generated config file

Auto-config options:
  --url <url>          Pre-fill target URL in generated config
  --output <path>      Output path for generated config file

Setup options:
  --repo <path>        Scan this repo path for routes, endpoints, and auth hints
  --no-scan            Skip repo scanning (default is auto-scan when in a git repo)

Triage options:
  --suppressed         findings list: only show suppressed findings
  --reason <text>      findings suppress: reason text recorded with the suppression
  --all                baselines approve: approve every baseline (delete all)

Examples:
  dramaturge run https://my-app.example.com           # Quick run, no config needed
  dramaturge run https://my-app.example.com --login    # Run with interactive auth
  dramaturge run --config custom.json                  # Run with config file
  dramaturge run https://app.example.com --preset smoke  # Quick smoke test
  dramaturge run https://app.example.com --preset security  # Security-focused scan
  dramaturge run https://app.example.com --focus api --focus adversarial  # Ad-hoc focus mix
  dramaturge setup                                     # Interactive onboarding
  dramaturge init --template minimal                   # Generate minimal config
  dramaturge auto-config --repo .                      # Generate config from repo context
  dramaturge doctor                                    # Check environment
  dramaturge findings list                             # List findings in memory
  dramaturge findings suppress abc123 --reason "known issue"
  dramaturge baselines approve --all                   # Recapture all visual baselines
  dramaturge memory stats                              # Summarize memory store

Environment variables:
  ANTHROPIC_API_KEY              API key for Anthropic models
  OPENAI_API_KEY                 API key for OpenAI models
  GOOGLE_GENERATIVE_AI_API_KEY   API key for Google models

Dramaturge auto-loads .env files from the current directory.
`;

const DEFAULT_CLI_DEPENDENCIES: CliDependencies = {
  loadConfig,
  runEngine,
  log: (message) => {
    console.log(message);
  },
  error: (message) => {
    console.error(message);
  },
};

export function buildHelpText(): string {
  return HELP_TEXT;
}

const KNOWN_COMMANDS = new Set([
  'run',
  'doctor',
  'init',
  'setup',
  'auto-config',
  'help',
  'findings',
  'baselines',
  'memory',
]);
const TRIAGE_COMMANDS = new Set(['findings', 'baselines', 'memory']);
const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'azure', 'openrouter', 'github']);
const VALID_PRESETS = new Set<string>(PRESET_NAMES);
const VALID_FOCUS_MODES = new Set<string>(FOCUS_MODES);
const VALID_FORMATS = new Set(['markdown', 'json', 'both', 'junit', 'sarif']);

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  let command: ParsedCliArgs['command'] = 'run';
  let configPath: string | undefined;
  let resumeDir: string | undefined;
  let diffRef: string | undefined;
  let dashboard = false;
  let url: string | undefined;
  let login: boolean | undefined;
  let headless: boolean | undefined;
  let provider: ParsedCliArgs['provider'];
  let preset: ParsedCliArgs['preset'];
  const focusModes: FocusMode[] = [];
  let formats: ParsedCliArgs['formats'];
  let initTemplate: InitTemplate | undefined;
  let initOutput: string | undefined;
  let repoPath: string | undefined;
  let noScan: true | undefined;
  let triageSubcommand: string | undefined;
  const triagePositional: string[] = [];
  let triageSuppressedOnly: boolean | undefined;
  let triageAll: boolean | undefined;
  let triageReason: string | undefined;

  let i = 0;

  // Detect subcommand (first arg if it's a known command name)
  if (args.length > 0 && KNOWN_COMMANDS.has(args[0])) {
    command = args[0] as ParsedCliArgs['command'];
    i = 1;
  }

  for (; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      return {
        command: 'help',
        dashboard: false,
        showHelp: true,
      };
    }

    if (arg === '--dashboard') {
      dashboard = true;
      continue;
    }

    if (arg === '--login') {
      login = true;
      continue;
    }

    if (arg === '--headless') {
      headless = true;
      continue;
    }

    if (arg === '--config') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --config');
      configPath = value;
      i++;
      continue;
    }

    if (arg === '--resume') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --resume');
      resumeDir = value;
      i++;
      continue;
    }

    if (arg === '--diff') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --diff');
      diffRef = value;
      i++;
      continue;
    }

    if (arg === '--provider') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --provider');
      if (!VALID_PROVIDERS.has(value)) {
        throw new Error(
          `Invalid provider: ${value}. Must be one of: anthropic, openai, google, azure, openrouter, github`
        );
      }
      provider = value as ParsedCliArgs['provider'];
      i++;
      continue;
    }

    if (arg === '--preset') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --preset');
      if (!VALID_PRESETS.has(value)) {
        throw new Error(
          `Invalid preset: ${value}. Must be one of: ${[...VALID_PRESETS].join(', ')}`
        );
      }
      preset = value as ParsedCliArgs['preset'];
      i++;
      continue;
    }

    if (arg === '--focus') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --focus');
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) throw new Error('Missing value for --focus');
      for (const part of parts) {
        if (!VALID_FOCUS_MODES.has(part)) {
          throw new Error(
            `Invalid focus mode: ${part}. Must be one of: ${[...VALID_FOCUS_MODES].join(', ')}`
          );
        }
        if (!focusModes.includes(part as FocusMode)) {
          focusModes.push(part as FocusMode);
        }
      }
      i++;
      continue;
    }

    if (arg === '--format') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --format');
      const parts = value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (parts.length === 0) throw new Error('Missing value for --format');
      for (const part of parts) {
        if (!VALID_FORMATS.has(part)) {
          throw new Error(
            `Invalid format: ${part}. Must be one of: markdown, json, both, junit, sarif`
          );
        }
      }
      formats = parts as NonNullable<ParsedCliArgs['formats']>;
      i++;
      continue;
    }

    if (arg === '--template') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --template');
      if (value !== 'minimal' && value !== 'full') {
        throw new Error(`Invalid template: ${value}. Must be one of: minimal, full`);
      }
      initTemplate = value;
      i++;
      continue;
    }

    if (arg === '--url') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --url');
      url = value;
      i++;
      continue;
    }

    if (arg === '--repo') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) throw new Error('Missing value for --repo');
      repoPath = value;
      i++;
      continue;
    }

    if (arg === '--no-scan') {
      noScan = true;
      continue;
    }

    if (arg === '--output') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --output');
      initOutput = value;
      i++;
      continue;
    }

    if (arg === '--suppressed') {
      triageSuppressedOnly = true;
      continue;
    }

    if (arg === '--all') {
      triageAll = true;
      continue;
    }

    if (arg === '--reason') {
      const value = args[i + 1];
      if (!value) throw new Error('Missing value for --reason');
      triageReason = value;
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    // Positional argument: treat as URL for `run` command
    if (command === 'run' && !url) {
      url = arg;
      continue;
    }

    // Positional arg for triage commands (signatures, baseline identifiers)
    if (TRIAGE_COMMANDS.has(command)) {
      if (!triageSubcommand) {
        triageSubcommand = arg;
      } else {
        triagePositional.push(arg);
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (noScan && repoPath) {
    throw new Error('--no-scan and --repo cannot be used together');
  }

  return {
    command,
    configPath,
    resumeDir,
    diffRef,
    dashboard,
    showHelp: false,
    url,
    login,
    headless,
    provider,
    preset,
    focusModes: focusModes.length > 0 ? focusModes : undefined,
    formats,
    initTemplate,
    initOutput,
    repoPath,
    noScan,
    ...(TRIAGE_COMMANDS.has(command)
      ? {
          triageSubcommand,
          triagePositional: triagePositional.length > 0 ? triagePositional : undefined,
          triageSuppressedOnly,
          triageAll,
          triageReason,
        }
      : {}),
  };
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = DEFAULT_CLI_DEPENDENCIES
): Promise<number> {
  // Auto-load .env before anything else
  loadDotenv();

  try {
    const parsedArgs = parseCliArgs(args);

    if (parsedArgs.showHelp) {
      dependencies.log(buildHelpText());
      return 0;
    }

    // Route to subcommand
    switch (parsedArgs.command) {
      case 'help':
        dependencies.log(buildHelpText());
        return 0;

      case 'doctor':
        return runDoctor({ log: dependencies.log, cwd: process.cwd() });

      case 'init':
        return runInit(
          {
            template: parsedArgs.initTemplate ?? 'minimal',
            targetUrl: parsedArgs.url,
            outputPath: parsedArgs.initOutput,
          },
          { log: dependencies.log, error: dependencies.error, cwd: process.cwd() }
        );

      case 'setup':
        return await runSetupCommand(dependencies, parsedArgs);

      case 'auto-config':
        return await runAutoConfigCommand(dependencies, parsedArgs);

      case 'run':
        return await runRunCommand(parsedArgs, dependencies);

      case 'findings':
      case 'baselines':
      case 'memory':
        return runTriageCommand(
          {
            command: parsedArgs.command,
            subcommand:
              parsedArgs.triageSubcommand ?? (parsedArgs.command === 'memory' ? 'stats' : 'list'),
            flags: {
              suppressed: parsedArgs.triageSuppressedOnly,
              all: parsedArgs.triageAll,
              reason: parsedArgs.triageReason,
            },
            positional: parsedArgs.triagePositional ?? [],
            configPath: parsedArgs.configPath,
          },
          { log: dependencies.log, error: dependencies.error, cwd: process.cwd() }
        );

      default:
        dependencies.error(`Unknown command: ${parsedArgs.command}`);
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.error(`Error: ${message}`);
    return 1;
  }
}

async function runSetupCommand(
  dependencies: CliDependencies,
  parsedArgs: ParsedCliArgs
): Promise<number> {
  const { runSetup } = await import('./commands/setup.js');
  const readline = await import('node:readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(`  ${question}: `, (answer) => resolve(answer.trim()));
    });

  const confirm = (question: string, defaultValue = false): Promise<boolean> =>
    new Promise((resolve) => {
      const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
      rl.question(`  ${question}${suffix}: `, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === '') resolve(defaultValue);
        else resolve(trimmed === 'y' || trimmed === 'yes');
      });
    });

  const select = (question: string, options: string[]): Promise<string> =>
    new Promise((resolve) => {
      dependencies.log(`  ${question}`);
      options.forEach((opt, idx) => {
        dependencies.log(`    ${idx + 1}. ${opt}`);
      });
      rl.question('  Choice: ', (answer) => {
        const idx = Number.parseInt(answer.trim(), 10) - 1;
        resolve(options[idx] ?? options[0]);
      });
    });

  try {
    return await runSetup(
      {
        log: dependencies.log,
        error: dependencies.error,
        cwd: process.cwd(),
        prompt,
        confirm,
        select,
      },
      {
        repoPath: parsedArgs.noScan ? false : parsedArgs.repoPath,
      }
    );
  } finally {
    rl.close();
  }
}

async function runAutoConfigCommand(
  dependencies: CliDependencies,
  parsedArgs: ParsedCliArgs
): Promise<number> {
  const { runAutoConfig } = await import('./commands/auto-config.js');
  const readline = await import('node:readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(`  ${question}: `, (answer) => resolve(answer.trim()));
    });

  const confirm = (question: string, defaultValue = false): Promise<boolean> =>
    new Promise((resolve) => {
      const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
      rl.question(`  ${question}${suffix}: `, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === '') resolve(defaultValue);
        else resolve(trimmed === 'y' || trimmed === 'yes');
      });
    });

  const select = (question: string, options: string[]): Promise<string> =>
    new Promise((resolve) => {
      dependencies.log(`  ${question}`);
      options.forEach((option, index) => {
        dependencies.log(`    ${index + 1}. ${option}`);
      });
      rl.question('  Choice: ', (answer) => {
        const index = Number.parseInt(answer.trim(), 10) - 1;
        resolve(options[index] ?? options[0]);
      });
    });

  try {
    return await runAutoConfig(
      {
        log: dependencies.log,
        error: dependencies.error,
        cwd: process.cwd(),
        prompt,
        confirm,
        select,
      },
      {
        repoPath: parsedArgs.noScan ? false : parsedArgs.repoPath,
        targetUrl: parsedArgs.url,
        outputPath: parsedArgs.initOutput,
      }
    );
  } finally {
    rl.close();
  }
}

async function runRunCommand(
  parsedArgs: ParsedCliArgs,
  dependencies: CliDependencies
): Promise<number> {
  let config: LoadedDramaturgeConfig;

  if (parsedArgs.url && !parsedArgs.configPath) {
    // Inline mode: build config from CLI args
    const inlineArgs: InlineRunArgs = {
      url: parsedArgs.url,
      login: parsedArgs.login,
      headless: parsedArgs.headless,
      provider: parsedArgs.provider,
      preset: parsedArgs.preset,
      focusModes: parsedArgs.focusModes,
      formats: parsedArgs.formats,
    };
    config = buildConfigFromArgs(inlineArgs);
  } else {
    // File mode: load config from file (existing behavior)
    config = dependencies.loadConfig(parsedArgs.configPath);
    if (parsedArgs.formats && parsedArgs.formats.length > 0) {
      config = {
        ...config,
        output: {
          ...config.output,
          format: parsedArgs.formats.length === 1 ? parsedArgs.formats[0] : [...parsedArgs.formats],
        },
      };
    }
  }

  const eventStream = new EngineEventEmitter();

  let dashboardHandle: { cleanup: () => void; waitUntilExit: Promise<void> } | undefined;

  if (parsedArgs.dashboard) {
    const { renderDashboard } = await import('./dashboard/render.js');
    dashboardHandle = renderDashboard(eventStream);
  } else {
    attachCliListeners(eventStream, dependencies.log);
  }

  await dependencies.runEngine(config, {
    resumeDir: resolveResumeDir(parsedArgs.resumeDir, config),
    eventStream,
    diffRef: parsedArgs.diffRef,
  });

  if (dashboardHandle) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    dashboardHandle.cleanup();
    await dashboardHandle.waitUntilExit;
  }

  return 0;
}

/**
 * Wire event-stream listeners that provide live terminal output during a run.
 * Exposed as a named export so tests can verify the wiring without running the engine.
 */
export function attachCliListeners(
  emitter: EngineEventEmitter,
  log: (message: string) => void
): void {
  emitter.on('task:start', (evt: TaskStartEvent) => {
    log(`[task ${evt.taskNumber}] ${evt.workerType}: ${evt.objective}`);
  });

  emitter.on('task:complete', (evt: TaskCompleteEvent) => {
    const coverage =
      evt.coverageExercised > 0
        ? ` | coverage: ${evt.coverageExercised}/${evt.coverageDiscovered}`
        : '';
    log(`[task ${evt.taskNumber}] ${evt.outcome}: ${evt.findingsCount} finding(s)${coverage}`);
  });

  emitter.on('finding', (evt: FindingEvent) => {
    log(`  ⚠ [${evt.severity}] ${evt.title}`);
  });

  emitter.on('state:discovered', (evt: StateDiscoveredEvent) => {
    log(`  ↳ new state: ${evt.pageType} (${evt.totalStates} total)`);
  });

  emitter.on('progress', (evt: ProgressEvent) => {
    const pct = Math.round(evt.estimatedProgress * 100);
    log(
      `── progress: ${pct}% | ${evt.tasksExecuted} done, ${evt.tasksRemaining} queued, ${evt.totalFindings} finding(s), ${evt.statesDiscovered} state(s)`
    );
  });

  emitter.on('run:error', (evt: ErrorEvent) => {
    log(`Error: ${evt.message}`);
  });
}

const executedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  const exitCode = await runCli();
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
