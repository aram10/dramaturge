// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { Coordinator } from './coordinator.js';
import { Blackboard } from './blackboard.js';
import { MessageBus } from './message-bus.js';
import type { FrontierItem } from '../types.js';

function makeItem(overrides: Partial<FrontierItem> = {}): FrontierItem {
  return {
    id: 'task-test-1',
    nodeId: 'node-1',
    workerType: 'navigation',
    objective: 'Explore the home page',
    priority: 0.7,
    reason: 'Auto-assigned',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
}

describe('A2A Integration', () => {
  it('coordinates task lifecycle end-to-end', () => {
    const blackboard = new Blackboard();
    const messageBus = new MessageBus();
    const coordinator = new Coordinator({ blackboard, messageBus });

    // Track blackboard activity
    const blackboardEntries: string[] = [];
    blackboard.subscribe('*', (entry) => {
      blackboardEntries.push(entry.kind);
    });

    // Track messages
    const messages: string[] = [];
    messageBus.onAny((msg) => {
      messages.push(`${msg.fromAgent} -> ${msg.toAgent}`);
    });

    // 1. Assign a navigation task
    const navItem = makeItem({ workerType: 'navigation' });
    const navTask = coordinator.assignTask(navItem);

    expect(navTask.assignedAgent).toBe('agent-scout');
    expect(navTask.status).toBe('submitted');
    expect(blackboardEntries).toContain('directive'); // task-assigned

    // 2. Update to working
    coordinator.updateTaskStatus(navTask.id, 'working');
    expect(coordinator.getTask(navTask.id)?.status).toBe('working');

    // 3. Complete with findings
    coordinator.completeTask(navTask.id, 'Found 2 navigation targets', 2);

    const completedTask = coordinator.getTask(navTask.id);
    expect(completedTask?.status).toBe('completed');
    expect(blackboardEntries).toContain('finding'); // task-completed

    // Reviewer should be notified about findings
    const reviewerMessages = messageBus.getMessagesTo('agent-reviewer');
    expect(reviewerMessages.length).toBeGreaterThan(0);
  });

  it('routes different worker types to appropriate agents', () => {
    const blackboard = new Blackboard();
    const messageBus = new MessageBus();
    const coordinator = new Coordinator({ blackboard, messageBus });

    const types: Array<{ workerType: FrontierItem['workerType']; expectedAgent: string }> = [
      { workerType: 'navigation', expectedAgent: 'agent-scout' },
      { workerType: 'form', expectedAgent: 'agent-tester' },
      { workerType: 'crud', expectedAgent: 'agent-tester' },
      { workerType: 'api', expectedAgent: 'agent-tester' },
      { workerType: 'adversarial', expectedAgent: 'agent-security' },
    ];

    for (const { workerType, expectedAgent } of types) {
      const item = makeItem({ workerType });
      const task = coordinator.assignTask(item);
      expect(task.assignedAgent).toBe(expectedAgent);
    }
  });

  it('posts to blackboard and broadcasts directives', () => {
    const blackboard = new Blackboard();
    const messageBus = new MessageBus();
    const coordinator = new Coordinator({ blackboard, messageBus });

    // Broadcast a directive from the reviewer
    coordinator.broadcastDirective('agent-reviewer', 'Focus on form validation', {
      priority: 'high',
    });

    // Check blackboard has directive
    const directives = blackboard.query('directive');
    const broadcast = directives.find((d) => (d.data as { type?: string }).type === 'broadcast');
    expect(broadcast).toBeDefined();
    expect(broadcast?.data.text).toBe('Focus on form validation');

    // Check message bus has broadcast
    const history = messageBus.getHistory();
    const broadcastMsg = history.find((m) => m.toAgent === '*');
    expect(broadcastMsg).toBeDefined();
    expect(broadcastMsg?.fromAgent).toBe('agent-reviewer');
  });
});
