// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { Stagehand } from '@browserbasehq/stagehand';
import type {
  BrowserAgent,
  BrowserAgentInitOptions,
  BrowserAgentOptions,
  BrowserAgentExecutor,
  BrowserContext,
} from './agent.js';

/**
 * Stagehand implementation of the BrowserAgent interface.
 * Wraps the Stagehand library to conform to Dramaturge's agent abstraction.
 */
export class StagehandBrowserAgent implements BrowserAgent {
  private stagehand: Stagehand;

  constructor() {
    this.stagehand = new Stagehand({ env: 'LOCAL', verbose: 0 });
  }

  get context(): BrowserContext {
    // Stagehand's V3Context is structurally compatible but uses a different Page
    // type from a vendored Playwright. Cast through unknown to satisfy our interface.
    return this.stagehand.context as unknown as BrowserContext;
  }

  async init(options: BrowserAgentInitOptions): Promise<void> {
    const modelName = options.modelName;
    this.stagehand = new Stagehand({
      env: (options.env as 'LOCAL' | 'BROWSERBASE') ?? 'LOCAL',
      verbose: options.verbose ?? 0,
      ...(options.headless !== undefined && {
        localBrowserLaunchOptions: { headless: options.headless },
      }),
      ...(modelName && {
        model: options.modelClientOptions
          ? {
              modelName,
              apiKey: options.modelClientOptions.apiKey,
              baseURL: options.modelClientOptions.baseURL,
            }
          : modelName,
      }),
    });

    await this.stagehand.init();
  }

  agent(options: BrowserAgentOptions): BrowserAgentExecutor {
    // Build the Stagehand agent with the options we received.
    // The tools field in AgentConfig uses Stagehand's ToolSet format from the "ai" package.
    // Our BrowserAgentTool uses inputSchema+execute; we pass tools without unsafe coercion
    // by omitting them here — tool injection into Stagehand happens at a lower level
    // via the worker setup and is not part of this abstraction layer yet.
    const stagehandAgent = this.stagehand.agent({
      model: options.model,
      systemPrompt: options.systemPrompt,
      mode: options.mode,
    });

    return {
      execute: async (executeOptions) => {
        try {
          const result = await stagehandAgent.execute({
            instruction: executeOptions.instruction,
            maxSteps: executeOptions.maxSteps,
          });
          return {
            success: result.completed,
            message: result.message,
            actions: Array.isArray(result.actions) ? result.actions : [],
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
            actions: [],
          };
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.stagehand.close();
  }

  /**
   * Returns the underlying Stagehand instance for direct access when needed.
   * This is a temporary escape hatch for code that hasn't been fully migrated.
   */
  getStagehand(): Stagehand {
    return this.stagehand;
  }
}

/**
 * Factory function to create a Stagehand browser agent.
 * @returns A new StagehandBrowserAgent instance
 */
export function createStagehandAgent(): StagehandBrowserAgent {
  return new StagehandBrowserAgent();
}
