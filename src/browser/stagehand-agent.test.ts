// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockAgent = vi.fn(() => ({ execute: mockExecute }));
  const mockInit = vi.fn();
  const mockClose = vi.fn();
  const mockPages = vi.fn(() => [{}]);
  const mockContext = { pages: mockPages };

  return { mockAgent, mockExecute, mockInit, mockClose, mockPages, mockContext };
});

vi.mock('@browserbasehq/stagehand', () => {
  function Stagehand(this: Record<string, unknown>) {
    this.init = mocks.mockInit;
    this.close = mocks.mockClose;
    this.agent = mocks.mockAgent;
    this.context = mocks.mockContext;
  }
  return { Stagehand };
});

import { StagehandBrowserAgent, createStagehandAgent } from './stagehand-agent.js';

describe('StagehandBrowserAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('context', () => {
    it('exposes the Stagehand context', () => {
      const agent = new StagehandBrowserAgent();
      expect(agent.context).toBe(mocks.mockContext);
    });
  });

  describe('init', () => {
    it('calls stagehand.init after reinitialising', async () => {
      const agent = new StagehandBrowserAgent();
      await agent.init({});
      expect(mocks.mockInit).toHaveBeenCalledOnce();
    });

    it('calls init with empty options', async () => {
      const agent = new StagehandBrowserAgent();
      await agent.init({});
      expect(mocks.mockInit).toHaveBeenCalledOnce();
    });
  });

  describe('agent', () => {
    it('calls stagehand.agent with systemPrompt, mode, and model', () => {
      const agent = new StagehandBrowserAgent();
      agent.agent({
        systemPrompt: 'Be a tester',
        mode: 'dom',
        model: 'anthropic/claude-3-5-haiku',
      });
      expect(mocks.mockAgent).toHaveBeenCalledWith({
        systemPrompt: 'Be a tester',
        mode: 'dom',
        model: 'anthropic/claude-3-5-haiku',
      });
    });

    it('returns an executor with an execute() method', () => {
      const agent = new StagehandBrowserAgent();
      const executor = agent.agent({});
      expect(typeof executor.execute).toBe('function');
    });

    it('execute() calls stagehandAgent.execute with instruction and maxSteps', async () => {
      mocks.mockExecute.mockResolvedValue({
        completed: true,
        message: 'done',
        actions: [{ type: 'click' }],
      });
      const agent = new StagehandBrowserAgent();
      const executor = agent.agent({});
      await executor.execute({ instruction: 'Click the button', maxSteps: 5 });
      expect(mocks.mockExecute).toHaveBeenCalledWith({
        instruction: 'Click the button',
        maxSteps: 5,
      });
    });

    it('execute() maps completed/message/actions from Stagehand result', async () => {
      mocks.mockExecute.mockResolvedValue({
        completed: true,
        message: 'Task finished',
        actions: [{ type: 'navigate' }, { type: 'click' }],
      });
      const agent = new StagehandBrowserAgent();
      const executor = agent.agent({});
      const result = await executor.execute({ instruction: 'Do something' });
      expect(result).toEqual({
        success: true,
        message: 'Task finished',
        actions: [{ type: 'navigate' }, { type: 'click' }],
      });
    });

    it('execute() returns success:false and error when stagehand throws', async () => {
      const boom = new Error('Stagehand exploded');
      mocks.mockExecute.mockRejectedValue(boom);
      const agent = new StagehandBrowserAgent();
      const executor = agent.agent({});
      const result = await executor.execute({ instruction: 'Do something' });
      expect(result.success).toBe(false);
      expect(result.error).toBe(boom);
      expect(result.actions).toEqual([]);
    });

    it('execute() wraps non-Error throws in an Error', async () => {
      mocks.mockExecute.mockRejectedValue('plain string error');
      const agent = new StagehandBrowserAgent();
      const executor = agent.agent({});
      const result = await executor.execute({ instruction: 'Do something' });
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('plain string error');
    });
  });

  describe('close', () => {
    it('calls stagehand.close()', async () => {
      const agent = new StagehandBrowserAgent();
      await agent.close();
      expect(mocks.mockClose).toHaveBeenCalledOnce();
    });
  });

  describe('getStagehand', () => {
    it('returns the underlying Stagehand instance', () => {
      const agent = new StagehandBrowserAgent();
      const sh = agent.getStagehand();
      expect(sh).toBeDefined();
      expect(typeof sh.agent).toBe('function');
    });
  });
});

describe('createStagehandAgent', () => {
  it('creates a StagehandBrowserAgent instance', () => {
    const agent = createStagehandAgent();
    expect(agent).toBeInstanceOf(StagehandBrowserAgent);
  });
});
