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
   * Creates a new agent instance for worker execution.
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
   * Model identifier for LLM operations.
   */
  modelName?: string;

  /**
   * Optional model configuration for API endpoint.
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
   * Whether to enable logging.
   */
  enableCaching?: boolean;

  /**
   * Optional verbose logging level (0-2).
   */
  verbose?: number;

  /**
   * Optional debugging port.
   */
  debugDom?: boolean;
}

/**
 * Configuration options for creating an agent executor.
 */
export interface BrowserAgentOptions {
  /**
   * Instruction prompt for the agent.
   */
  instructions?: string;

  /**
   * Tools available to the agent.
   */
  tools?: Record<string, BrowserAgentTool>;

  /**
   * Agent mode: 'cua' (computer-use agent) or 'dom' (DOM inspection).
   */
  mode?: 'cua' | 'dom';
}

/**
 * Tool definition for browser agents.
 */
export interface BrowserAgentTool {
  description: string;
  parameters: Record<string, unknown>;
  method: (...args: unknown[]) => Promise<unknown> | unknown;
}

/**
 * Handle returned by agent() for executing tasks.
 */
export interface BrowserAgentExecutor {
  /**
   * Executes the agent with the given instruction.
   * @param instruction - Task instruction for the agent
   * @returns Execution result
   */
  (instruction: string): Promise<BrowserAgentResult>;
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
}
