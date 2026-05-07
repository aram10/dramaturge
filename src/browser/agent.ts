// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Page } from 'playwright';

/**
 * Abstract interface for browser agents used by Dramaturge.
 * This allows the engine to be decoupled from specific agent implementations.
 */
export interface BrowserAgent {
  /**
   * The browser context containing page instances.
   */
  readonly context: BrowserContext;

  /**
   * Initializes the agent with configuration options.
   * @param options - Agent initialization options
   */
  init(options: BrowserAgentInitOptions): Promise<void>;

  /**
   * Creates a new agent executor for worker execution.
   * @param options - Agent configuration options
   * @returns An agent executor handle
   */
  agent(options: BrowserAgentOptions): BrowserAgentExecutor;

  /**
   * Closes the browser agent and cleans up resources.
   */
  close(): Promise<void>;
}

/**
 * Browser context interface compatible with Playwright's BrowserContext.
 */
export interface BrowserContext {
  /**
   * Returns all open pages in this context.
   */
  pages(): Page[];

  /**
   * Adds cookies to the browser context.
   */
  addCookies?(
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
    }>
  ): Promise<unknown>;

  /**
   * Returns all cookies in the browser context.
   */
  cookies?(): Promise<
    Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
    }>
  >;
}

/**
 * Initialization options for browser agents.
 */
export interface BrowserAgentInitOptions {
  /**
   * Model name for LLM operations (e.g. 'openai/gpt-4o').
   */
  modelName?: string;

  /**
   * Optional model API configuration.
   */
  modelClientOptions?: {
    apiKey?: string;
    baseURL?: string;
  };

  /**
   * Environment setting (e.g., 'LOCAL', 'BROWSERBASE').
   */
  env?: string;

  /**
   * Whether to run in headless mode.
   */
  headless?: boolean;

  /**
   * Optional verbose logging level (0-2).
   */
  verbose?: 0 | 1 | 2;
}

/**
 * Configuration options for creating an agent executor.
 * These map to the per-agent options passed by each worker invocation.
 */
export interface BrowserAgentOptions {
  /**
   * Model identifier to use for this agent (e.g. 'anthropic/claude-3-5-haiku').
   */
  model?: string;

  /**
   * System prompt providing context and instructions to the agent.
   */
  systemPrompt?: string;

  /**
   * Tools available to the agent. Each tool uses the same shape as worker tools:
   * an `inputSchema` (Zod schema) and an async `execute` function.
   */
  tools?: Record<string, BrowserAgentTool>;

  /**
   * Agent mode: 'cua' (computer-use), 'dom' (DOM inspection), or 'hybrid'.
   */
  mode?: 'cua' | 'dom' | 'hybrid';
}

/**
 * Tool definition for browser agents.
 * Matches the tool shape used in src/worker/tools.ts (inputSchema + execute).
 */
export interface BrowserAgentTool {
  description: string;
  /** JSON Schema object describing the tool input parameters. */
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
}

/**
 * Options passed to each execute() call on the agent executor.
 */
export interface BrowserAgentExecuteOptions {
  /** Natural language instruction for the agent to carry out. */
  instruction: string;
  /** Maximum number of steps the agent may take before stopping. */
  maxSteps?: number;
}

/**
 * Handle returned by agent() for executing tasks.
 */
export interface BrowserAgentExecutor {
  /**
   * Executes the agent with the given options.
   * @param options - Execution options including the instruction and optional step limit
   * @returns Execution result
   */
  execute(options: BrowserAgentExecuteOptions): Promise<BrowserAgentResult>;
}

/**
 * Result of agent execution.
 */
export interface BrowserAgentResult {
  /**
   * Whether the agent completed successfully.
   */
  success: boolean;

  /**
   * Optional result message or data.
   */
  message?: string;

  /**
   * Optional error if execution failed.
   */
  error?: Error;

  /**
   * Actions taken by the agent during execution.
   * Matches the `result.actions` array returned by Stagehand's agent.execute().
   */
  actions?: unknown[];
}
