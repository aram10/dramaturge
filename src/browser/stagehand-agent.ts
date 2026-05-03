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
    this.stagehand = new Stagehand({
      env: 'LOCAL',
      verbose: 0,
      debugDom: false,
      headless: false,
      enableCaching: false,
    });
  }

  get context(): BrowserContext {
    return this.stagehand.context;
  }

  async init(options: BrowserAgentInitOptions): Promise<void> {
    // Stagehand is initialized in constructor, but we can update config here
    this.stagehand = new Stagehand({
      env: (options.env as 'LOCAL' | 'BROWSERBASE') ?? 'LOCAL',
      verbose: options.verbose ?? 0,
      debugDom: options.debugDom ?? false,
      headless: options.headless ?? false,
      enableCaching: options.enableCaching ?? false,
      modelName: options.modelName,
      modelClientOptions: options.modelClientOptions,
    });

    await this.stagehand.init();
  }

  agent(options: BrowserAgentOptions): BrowserAgentExecutor {
    // Convert our generic agent options to Stagehand's format
    const stagehandAgent = this.stagehand.agent({
      instructions: options.instructions,
      tools: options.tools as Parameters<Stagehand['agent']>[0]['tools'],
      mode: options.mode,
    });

    // Return a wrapper that conforms to BrowserAgentExecutor
    return async (instruction: string) => {
      try {
        await stagehandAgent(instruction);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
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
