#!/usr/bin/env node
import { loadConfig } from "./config.js";

const args = process.argv.slice(2);

let configPath: string | undefined;
let resumeDir: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config" && args[i + 1]) {
    configPath = args[i + 1];
    i++;
  } else if (args[i] === "--resume" && args[i + 1]) {
    resumeDir = args[i + 1];
    i++;
  }
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: webprobe [--config <path>] [--resume <run-dir>]

Options:
  --config <path>      Path to config file (default: webprobe.config.json)
  --resume <run-dir>   Resume a previous run from its output directory
  --help, -h           Show this help message

Repo-aware config:
  repoContext.root     Optional repo root for source-aware route/selector hints
  bootstrap.command    Optional command to start a local app before probing

Environment variables:
  ANTHROPIC_API_KEY              API key for Anthropic models (enables LLM planner)
  OPENAI_API_KEY                 API key for OpenAI models
  GOOGLE_GENERATIVE_AI_API_KEY   API key for Google models
`);
  process.exit(0);
}

try {
  const config = loadConfig(configPath);
  const { runEngine } = await import("./engine.js");
  await runEngine(config, { resumeDir });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
