// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionRecorder } from './action-recorder.js';
import { createWorkerTools } from './tools.js';
import { Blackboard } from '../a2a/blackboard.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-tools-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('createWorkerTools', () => {
  it('writes screenshots with an internal filename instead of the agent ref', async () => {
    const screenshotDir = createTempDir();
    const observations: any[] = [];
    const evidence: any[] = [];
    const screenshots = new Map<string, Buffer>();
    const actionRecorder = new ActionRecorder();
    const tools = createWorkerTools(
      observations,
      screenshots,
      evidence,
      { recordEvent: vi.fn() } as any,
      {
        url: () => 'https://example.com/manage/knowledge-bases',
        screenshot: vi.fn().mockResolvedValue(Buffer.from('png-data')),
      } as any,
      screenshotDir,
      'Knowledge bases',
      [],
      [],
      true,
      { actionRecorder }
    );

    const result = await tools.take_screenshot.execute({
      ref: '../escape/outside',
      annotation: 'Broken dialog',
    });

    expect(result.captured).toBe(true);
    expect(result.filename).toBeDefined();
    expect(result.filename).toMatch(/^ss-[A-Za-z0-9_-]+\.png$/);
    expect(result.filename).not.toContain('..');
    expect(result.filename).not.toContain('/');
    expect(existsSync(join(screenshotDir, result.filename!))).toBe(true);
    expect(evidence[0]).toMatchObject({
      id: result.evidenceId,
      path: `screenshots/${result.filename}`,
      summary: 'Broken dialog',
    });
  });

  it('links evidence back to a stable finding ref instead of an array index', async () => {
    const screenshotDir = createTempDir();
    const observations: any[] = [];
    const evidence: any[] = [];
    const screenshots = new Map<string, Buffer>();
    const actionRecorder = new ActionRecorder();
    const tools = createWorkerTools(
      observations,
      screenshots,
      evidence,
      { recordEvent: vi.fn() } as any,
      {
        url: () => 'https://example.com/manage/knowledge-bases',
        screenshot: vi.fn().mockResolvedValue(Buffer.from('png-data')),
      } as any,
      screenshotDir,
      'Knowledge bases',
      [],
      [],
      true,
      { actionRecorder }
    );

    const shot = await tools.take_screenshot.execute({
      ref: 'create-button',
      annotation: 'Create button before click',
    });
    expect(shot.evidenceId).toBeDefined();

    await tools.log_finding.execute({
      category: 'Bug',
      severity: 'Major',
      title: 'Create button stops responding',
      stepsToReproduce: ['Open the page', 'Click Create'],
      expected: 'A dialog opens',
      actual: 'Nothing happens',
      evidenceIds: [shot.evidenceId!],
    });

    expect(observations[0].id).toMatch(/^obs-/);
    expect(evidence[0].relatedFindingIds).toEqual([observations[0].id]);
    expect(evidence[0].relatedFindingIds).not.toEqual(['0']);
    expect(observations[0].verdictHint).toBeUndefined();
    expect(observations[0].actionIds).toHaveLength(1);
    expect(observations[0].evidenceIds).toEqual([shot.evidenceId]);
  });

  it('includes post_to_blackboard tool when blackboard is provided', () => {
    const screenshotDir = createTempDir();
    const blackboard = new Blackboard();
    const tools = createWorkerTools(
      [],
      new Map(),
      [],
      { recordEvent: vi.fn() } as any,
      { url: () => 'https://example.com' } as any,
      screenshotDir,
      'Test area',
      [],
      [],
      true,
      { blackboard, agentId: 'agent-tester' }
    );

    expect(tools.post_to_blackboard).toBeDefined();
  });

  it('post_to_blackboard posts an entry to the blackboard', async () => {
    const screenshotDir = createTempDir();
    const blackboard = new Blackboard();
    const tools = createWorkerTools(
      [],
      new Map(),
      [],
      { recordEvent: vi.fn() } as any,
      { url: () => 'https://example.com/settings' } as any,
      screenshotDir,
      'Settings',
      [],
      [],
      true,
      { blackboard, agentId: 'agent-tester' }
    );

    const result = await (tools as any).post_to_blackboard.execute({
      kind: 'finding',
      summary: 'Broken save button',
      tags: ['critical'],
    });

    expect(result.posted).toBe(true);
    expect(result.entryId).toMatch(/^bb-/);
    expect(blackboard.size()).toBe(1);
    expect(blackboard.query('finding')[0].agentId).toBe('agent-tester');
    expect(blackboard.query('finding')[0].data.summary).toBe('Broken save button');
  });

  it('omits post_to_blackboard tool when blackboard is not provided', () => {
    const screenshotDir = createTempDir();
    const tools = createWorkerTools(
      [],
      new Map(),
      [],
      { recordEvent: vi.fn() } as any,
      { url: () => 'https://example.com' } as any,
      screenshotDir,
      'Test area'
    );

    expect((tools as any).post_to_blackboard).toBeUndefined();
  });
});
