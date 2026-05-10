#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { pathToFileURL } from 'node:url';
import yargs from 'yargs';
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
import { runBenchmarkCommand as runBenchmarkCommandImpl } from './commands/benchmark.js';
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
    | 'mcp'
    | 'doctor'
    | 'init'
    | 'setup'
    | 'auth'
    | 'auto-config'
    | 'findings'
    | 'baselines'
    | 'memory'
    | 'benchmark'
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
  /** --profile flag for multi-role auth */
  profile?: string;
  /** --template flag for init */
  initTemplate?: InitTemplate;
  /** --output flag for init */
  initOutput?: string;
  /** --repo flag for setup: path to scan for repo-aware bootstrap */
  repoPath?: string;
  /** --no-scan flag for setup: disables repo scan entirely */
  noScan?: true;
  /** Subcommand after auth (e.g. "capture", "list") */
  authSubcommand?: string;
  /** --profile flag for auth capture */
  authProfile?: string;
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
  /** Optional app ID for benchmark command */
  benchmarkAppId?: string;
  /** --save flag for benchmark command */
  benchmarkSave?: boolean;
  /** --output flag for benchmark command */
  benchmarkOutput?: string;
}

export interface CliDependencies {
  loadConfig: (configPath?: string) => LoadedDramaturgeConfig;
  runEngine: (config: DramaturgeConfig, options?: RunEngineOptions) => Promise<void>;
  runMcpServer?: () => Promise<void>;
  log: (message: string) => void;
  error: (message: string) => void;
}

const HELP_TEXT = `Usage: dramaturge <command> [options]

Commands:
  run [url]            Run exploratory QA (default command)
  mcp                  Start the Dramaturge MCP server over stdio
  setup                Interactive first-run onboarding wizard
  auth <sub>           Capture or list auth profiles (capture | list)
  init                 Generate a config file from a template
  auto-config          AI-assisted config generation from repo context
  doctor               Check environment and configuration
  findings <sub>       Triage findings in memory (list | suppress | unsuppress)
  baselines <sub>      Manage visual-regression baselines (list | approve)
  memory stats         Show memory store statistics
  benchmark [app-id]   Run signal-to-noise benchmarks against well-known apps

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
  --profile <name>     Auth profile to use (when config has multiple auth profiles)
  --help, -h           Show this help message

Init options:
  --template <name>    Template to use: minimal (default) or full
  --url <url>          Pre-fill target URL in generated config
  --output <path>      Output path for generated config file

Auto-config options:
  --url <url>          Pre-fill target URL in generated config
  --output <path>      Output path for generated config file
  --repo <path>        Scan this repo path for routes, endpoints, and auth hints
  --no-scan            Skip repo scanning (default is auto-scan when in a git repo)

Setup options:
  --repo <path>        Scan this repo path for routes, endpoints, and auth hints
  --no-scan            Skip repo scanning (default is auto-scan when in a git repo)

Auth options:
  --config <path>      Config file to read the login URL from (default: dramaturge.config.json)
  --profile <name>     Profile name for the saved state file (default: user)
  --url <url>          Override login URL (skips reading from config)

Triage options:
  --suppressed         findings list: only show suppressed findings
  --reason <text>      findings suppress: reason text recorded with the suppression
  --all                baselines approve: approve every baseline (delete all)

Benchmark options:
  --save               Save benchmark results to disk
  --output <dir>       Output directory for benchmark results (default: ./benchmarks/results)

Examples:
  dramaturge run https://my-app.example.com           # Quick run, no config needed
  dramaturge run https://my-app.example.com --login    # Run with interactive auth
  dramaturge run --config custom.json                  # Run with config file
  dramaturge run https://app.example.com --preset smoke  # Quick smoke test
  dramaturge run https://app.example.com --preset security  # Security-focused scan
  dramaturge run https://app.example.com --focus api --focus adversarial  # Ad-hoc focus mix
  dramaturge mcp                                       # Expose Dramaturge as an MCP server
  dramaturge setup                                     # Interactive onboarding
  dramaturge auth capture --profile admin               # Capture storage state to .dramaturge-state/admin.json
  dramaturge auth list                                  # List saved profiles in .dramaturge-state
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
  'mcp',
  'doctor',
  'init',
  'setup',
  'auth',
  'auto-config',
  'help',
  'findings',
  'baselines',
  'memory',
  'benchmark',
]);
const TRIAGE_COMMANDS = new Set(['findings', 'baselines', 'memory']);
const VALID_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'azure', 'openrouter', 'github']);
const VALID_PRESETS = new Set<string>(PRESET_NAMES);
const VALID_FOCUS_MODES = new Set<string>(FOCUS_MODES);
const VALID_FORMATS = new Set(['markdown', 'json', 'both', 'junit', 'sarif']);
const VALUE_FLAGS = new Set([
  '--config',
  '--resume',
  '--diff',
  '--url',
  '--output',
  '--reason',
  '--provider',
  '--preset',
  '--focus',
  '--format',
  '--profile',
  '--template',
  '--repo',
]);

function parseProvider(value: string): ParsedCliArgs['provider'] {
  if (!VALID_PROVIDERS.has(value)) {
    throw new Error(
      `Invalid provider: ${value}. Must be one of: anthropic, openai, google, azure, openrouter, github`
    );
  }
  return value as ParsedCliArgs['provider'];
}

function parsePreset(value: string): ParsedCliArgs['preset'] {
  if (!VALID_PRESETS.has(value)) {
    throw new Error(`Invalid preset: ${value}. Must be one of: ${[...VALID_PRESETS].join(', ')}`);
  }
  return value as ParsedCliArgs['preset'];
}

function parseTemplate(value: string): InitTemplate {
  if (value !== 'minimal' && value !== 'full') {
    throw new Error(`Invalid template: ${value}. Must be one of: minimal, full`);
  }
  return value;
}

function assertValueFlagsHaveValues(args: readonly string[]): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const eqIndex = arg.indexOf('=');
    const flagName = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    if (!VALUE_FLAGS.has(flagName)) {
      continue;
    }
    if (eqIndex !== -1) {
      // --flag=value form: only reject when the value part is empty (--flag=)
      if (arg.slice(eqIndex + 1).length === 0) {
        throw new Error(`Missing value for ${flagName}`);
      }
      continue;
    }
    // --flag form: next arg must exist and must not look like another flag
    const nextArg = args[index + 1];
    if (!nextArg || nextArg.startsWith('-')) {
      throw new Error(`Missing value for ${flagName}`);
    }
  }
}

function parseFocusModes(values: readonly string[] | undefined): FocusMode[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const focusModes: FocusMode[] = [];
  for (const value of values) {
    for (const mode of parseFocusValue(value)) {
      if (!focusModes.includes(mode)) {
        focusModes.push(mode);
      }
    }
  }
  return focusModes;
}

function parsePositionals(
  positionals: readonly string[],
  parsedUrl?: string
): {
  command: ParsedCliArgs['command'];
  url?: string;
  authSubcommand?: string;
  triageSubcommand?: string;
  triagePositional?: string[];
  benchmarkAppId?: string;
} {
  const [firstPositional] = positionals;
  const hasExplicitCommand = !!firstPositional && KNOWN_COMMANDS.has(firstPositional);
  const command = hasExplicitCommand ? (firstPositional as ParsedCliArgs['command']) : 'run';
  let index = hasExplicitCommand ? 1 : 0;
  let url = parsedUrl;

  if (command === 'run' && !url && positionals[index]) {
    url = positionals[index];
    index++;
  }

  if (command === 'auth') {
    const authSubcommand = positionals[index];
    index += authSubcommand ? 1 : 0;
    if (positionals[index]) {
      throw new Error(`Unknown argument: ${positionals[index]}`);
    }
    return { command, url, authSubcommand };
  }

  if (TRIAGE_COMMANDS.has(command)) {
    const triageSubcommand = positionals[index];
    const triagePositional =
      positionals.length > index + 1 ? [...positionals.slice(index + 1)] : undefined;
    return { command, url, triageSubcommand, triagePositional };
  }

  if (command === 'benchmark') {
    const benchmarkAppId = positionals[index];
    index += benchmarkAppId ? 1 : 0;
    if (positionals[index]) {
      throw new Error(`Unknown argument: ${positionals[index]}`);
    }
    return { command, url, benchmarkAppId };
  }

  if (positionals[index]) {
    throw new Error(`Unknown argument: ${positionals[index]}`);
  }

  return { command, url };
}

function parseWithYargs(args: readonly string[]) {
  return yargs(args)
    .exitProcess(false)
    .help(false)
    .version(false)
    .strictOptions()
    .parserConfiguration({
      'boolean-negation': false,
    })
    .fail((message: string, error?: Error) => {
      throw error ?? new Error(message);
    })
    .option('config', { type: 'string' })
    .option('resume', { type: 'string' })
    .option('diff', { type: 'string' })
    .option('dashboard', { type: 'boolean' })
    .option('login', { type: 'boolean' })
    .option('headless', { type: 'boolean' })
    .option('provider', { type: 'string', coerce: parseProvider })
    .option('preset', { type: 'string', coerce: parsePreset })
    .option('focus', { type: 'string', array: true, coerce: parseFocusModes })
    .option('format', { type: 'string', coerce: parseFormatValue })
    .option('profile', { type: 'string' })
    .option('template', { type: 'string', coerce: parseTemplate })
    .option('url', { type: 'string' })
    .option('output', { type: 'string' })
    .option('repo', { type: 'string' })
    .option('no-scan', { type: 'boolean' })
    .option('suppressed', { type: 'boolean' })
    .option('all', { type: 'boolean' })
    .option('reason', { type: 'string' })
    .option('save', { type: 'boolean' })
    .parseSync();
}

/** Parse --focus <value> into validated FocusMode parts. */
function parseFocusValue(value: string): FocusMode[] {
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error('Missing value for --focus');
  for (const part of parts) {
    if (!VALID_FOCUS_MODES.has(part)) {
      throw new Error(
        `Invalid focus mode: ${part}. Must be one of: ${[...VALID_FOCUS_MODES].join(', ')}`
      );
    }
  }
  return parts as FocusMode[];
}

/** Parse --format <value> into validated format parts. */
function parseFormatValue(value: string): NonNullable<ParsedCliArgs['formats']> {
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error('Missing value for --format');
  for (const part of parts) {
    if (!VALID_FORMATS.has(part)) {
      throw new Error(
        `Invalid format: ${part}. Must be one of: markdown, json, both, junit, sarif`
      );
    }
  }
  return parts as NonNullable<ParsedCliArgs['formats']>;
}

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  if (args.includes('--help') || args.includes('-h')) {
    return { command: 'help', dashboard: false, showHelp: true };
  }

  assertValueFlagsHaveValues(args);
  const argv = parseWithYargs(args);
  const positionals = argv._.map((value) => String(value));
  const positionalArgs = parsePositionals(positionals, argv.url);
  const provider = argv.provider as ParsedCliArgs['provider'] | undefined;
  const preset = argv.preset as ParsedCliArgs['preset'] | undefined;
  const focusModes = argv.focus as FocusMode[] | undefined;
  const formats = argv.format as ParsedCliArgs['formats'] | undefined;
  const initTemplate = argv.template as InitTemplate | undefined;
  const repoPath = argv.repo;
  const noScan = argv.noScan || undefined;

  if (noScan && repoPath) {
    throw new Error('--no-scan and --repo cannot be used together');
  }

  return {
    command: positionalArgs.command,
    configPath: argv.config,
    resumeDir: argv.resume,
    diffRef: argv.diff,
    dashboard: argv.dashboard ?? false,
    showHelp: false,
    url: positionalArgs.url,
    login: argv.login ?? undefined,
    headless: argv.headless ?? undefined,
    provider,
    preset,
    initTemplate,
    initOutput: positionalArgs.command === 'benchmark' ? undefined : argv.output,
    repoPath,
    noScan,
    ...(focusModes ? { focusModes } : {}),
    ...(formats ? { formats } : {}),
    ...(argv.profile ? { profile: argv.profile } : {}),
    ...(positionalArgs.command === 'auth'
      ? {
          authSubcommand: positionalArgs.authSubcommand,
          authProfile: argv.profile,
        }
      : {}),
    ...(TRIAGE_COMMANDS.has(positionalArgs.command)
      ? {
          triageSubcommand: positionalArgs.triageSubcommand,
          triagePositional: positionalArgs.triagePositional,
          triageSuppressedOnly: argv.suppressed ?? undefined,
          triageAll: argv.all ?? undefined,
          triageReason: argv.reason,
        }
      : {}),
    ...(positionalArgs.command === 'benchmark'
      ? {
          benchmarkAppId: positionalArgs.benchmarkAppId,
          benchmarkSave: argv.save ?? undefined,
          benchmarkOutput: argv.output,
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

      case 'mcp':
        return await runMcpCommand(dependencies);

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

      case 'auth':
        return await runAuthCommand(dependencies, parsedArgs);

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

      case 'benchmark':
        return await runBenchmarkCommand(dependencies, parsedArgs);

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

async function runMcpCommand(dependencies: CliDependencies): Promise<number> {
  if (dependencies.runMcpServer) {
    await dependencies.runMcpServer();
    return 0;
  }

  const { runMcpServer } = await import('./mcp/server.js');
  await runMcpServer();
  return 0;
}

async function runAuthCommand(
  dependencies: CliDependencies,
  parsedArgs: ParsedCliArgs
): Promise<number> {
  const { runAuthCommand: runAuthCommandInner } = await import('./commands/auth.js');
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

  try {
    return await runAuthCommandInner(
      {
        subcommand: parsedArgs.authSubcommand,
        configPath: parsedArgs.configPath,
        profile: parsedArgs.authProfile,
        url: parsedArgs.url,
      },
      {
        log: dependencies.log,
        error: dependencies.error,
        cwd: process.cwd(),
        prompt,
        confirm,
        loadConfig: dependencies.loadConfig,
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

async function runBenchmarkCommand(
  dependencies: CliDependencies,
  parsedArgs: ParsedCliArgs
): Promise<number> {
  return runBenchmarkCommandImpl(
    {
      appId: parsedArgs.benchmarkAppId,
      save: parsedArgs.benchmarkSave,
      outputDir: parsedArgs.benchmarkOutput,
    },
    {
      log: dependencies.log,
      error: dependencies.error,
    }
  );
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
    profile: parsedArgs.profile,
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
