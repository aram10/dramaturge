#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig, type LoadedDramaturgeConfig, type DramaturgeConfig } from "./config.js";
import { resolveResumeDir } from "./config-paths.js";
import { runEngine, type RunEngineOptions } from "./engine.js";
import { EngineEventEmitter } from "./engine/event-stream.js";
import type { ErrorEvent, FindingEvent, ProgressEvent, StateDiscoveredEvent, TaskStartEvent, TaskCompleteEvent } from "./engine/event-stream.js";

export interface ParsedCliArgs {
  configPath?: string;
  resumeDir?: string;
  showHelp: boolean;
}

export interface CliDependencies {
  loadConfig: (configPath?: string) => LoadedDramaturgeConfig;
  runEngine: (
    config: DramaturgeConfig,
    options?: RunEngineOptions
  ) => Promise<void>;
  log: (message: string) => void;
  error: (message: string) => void;
}

const HELP_TEXT = `Usage: dramaturge [--config <path>] [--resume <run-dir>]

Options:
  --config <path>      Path to config file (default: dramaturge.config.json)
  --resume <run-dir>   Resume a previous run from its output directory
  --help, -h           Show this help message

Repo-aware config:
  repoContext.root     Optional repo root for source-aware route/selector hints
  bootstrap.command    Optional command to start a local app before probing

Environment variables:
  ANTHROPIC_API_KEY              API key for Anthropic models (enables LLM planner)
  OPENAI_API_KEY                 API key for OpenAI models
  GOOGLE_GENERATIVE_AI_API_KEY   API key for Google models
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

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  let configPath: string | undefined;
  let resumeDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      return { configPath, resumeDir, showHelp: true };
    }

    if (arg === "--config") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --config");
      }
      configPath = value;
      i++;
      continue;
    }

    if (arg === "--resume") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("Missing value for --resume");
      }
      resumeDir = value;
      i++;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { configPath, resumeDir, showHelp: false };
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = DEFAULT_CLI_DEPENDENCIES
): Promise<number> {
  try {
    const parsedArgs = parseCliArgs(args);
    if (parsedArgs.showHelp) {
      dependencies.log(buildHelpText());
      return 0;
    }

    const config = dependencies.loadConfig(parsedArgs.configPath);

    const eventStream = new EngineEventEmitter();
    attachCliListeners(eventStream, dependencies.log);

    await dependencies.runEngine(config, {
      resumeDir: resolveResumeDir(parsedArgs.resumeDir, config),
      eventStream,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.error(`Error: ${message}`);
    return 1;
  }
}

/**
 * Wire event-stream listeners that provide live terminal output during a run.
 * Exposed as a named export so tests can verify the wiring without running the engine.
 */
export function attachCliListeners(
  emitter: EngineEventEmitter,
  log: (message: string) => void
): void {
  emitter.on("task:start", (evt: TaskStartEvent) => {
    log(`[task ${evt.taskNumber}] ${evt.workerType}: ${evt.objective}`);
  });

  emitter.on("task:complete", (evt: TaskCompleteEvent) => {
    const coverage =
      evt.coverageExercised > 0
        ? ` | coverage: ${evt.coverageExercised}/${evt.coverageDiscovered}`
        : "";
    log(`[task ${evt.taskNumber}] ${evt.outcome}: ${evt.findingsCount} finding(s)${coverage}`);
  });

  emitter.on("finding", (evt: FindingEvent) => {
    log(`  ⚠ [${evt.severity}] ${evt.title}`);
  });

  emitter.on("state:discovered", (evt: StateDiscoveredEvent) => {
    log(`  ↳ new state: ${evt.pageType} (${evt.totalStates} total)`);
  });

  emitter.on("progress", (evt: ProgressEvent) => {
    const pct = Math.round(evt.estimatedProgress * 100);
    log(
      `── progress: ${pct}% | ${evt.tasksExecuted} done, ${evt.tasksRemaining} queued, ${evt.totalFindings} finding(s), ${evt.statesDiscovered} state(s)`
    );
  });

  emitter.on("run:error", (evt: ErrorEvent) => {
    log(`Error: ${evt.message}`);
  });
}

const executedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  const exitCode = await runCli();
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
