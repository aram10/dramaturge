#!/usr/bin/env node
import { loadConfig } from "./config.js";

const args = process.argv.slice(2);

let configPath: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--config" && args[i + 1]) {
    configPath = args[i + 1];
    break;
  }
}

const legacyMode = args.includes("--legacy");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: webprobe [--config <path>] [--legacy]

Options:
  --config <path>  Path to config file (default: webprobe.config.json)
  --legacy         Use the v1 flat orchestrator loop instead of the v2 engine
  --help, -h       Show this help message

Environment variables:
  ANTHROPIC_API_KEY              API key for Anthropic models
  OPENAI_API_KEY                 API key for OpenAI models
  GOOGLE_GENERATIVE_AI_API_KEY   API key for Google models
`);
  process.exit(0);
}

try {
  const config = loadConfig(configPath);
  if (legacyMode) {
    const { run } = await import("./runner.js");
    await run(config);
  } else {
    const { runEngine } = await import("./engine.js");
    await runEngine(config);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
