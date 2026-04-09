// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import {
  AGENT_CARDS,
  agentRoleForWorkerType,
  agentCardForWorkerType,
  findCapableAgents,
} from './agent-cards.js';
import type { AgentRole } from './types.js';
import type { WorkerType } from '../types.js';

describe('AGENT_CARDS', () => {
  it('contains all five agent roles', () => {
    const roles: AgentRole[] = ['scout', 'tester', 'security', 'reviewer', 'reporter'];
    for (const role of roles) {
      expect(AGENT_CARDS[role]).toBeDefined();
      expect(AGENT_CARDS[role].role).toBe(role);
    }
  });

  it('every card has a non-empty id and name', () => {
    for (const card of Object.values(AGENT_CARDS)) {
      expect(card.id).toBeTruthy();
      expect(card.name).toBeTruthy();
      expect(card.description).toBeTruthy();
    }
  });

  it('every card has at least one skill', () => {
    for (const card of Object.values(AGENT_CARDS)) {
      expect(card.skills.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every card has a protocol version', () => {
    for (const card of Object.values(AGENT_CARDS)) {
      expect(card.protocolVersion).toBeTruthy();
    }
  });

  it('scout supports only navigation', () => {
    expect(AGENT_CARDS.scout.supportedWorkerTypes).toEqual(['navigation']);
  });

  it('tester supports form, crud, and api', () => {
    expect(AGENT_CARDS.tester.supportedWorkerTypes).toContain('form');
    expect(AGENT_CARDS.tester.supportedWorkerTypes).toContain('crud');
    expect(AGENT_CARDS.tester.supportedWorkerTypes).toContain('api');
  });

  it('security supports adversarial', () => {
    expect(AGENT_CARDS.security.supportedWorkerTypes).toEqual(['adversarial']);
  });

  it('reviewer and reporter support all worker types', () => {
    const allTypes: WorkerType[] = ['navigation', 'form', 'crud', 'api', 'adversarial'];
    for (const wt of allTypes) {
      expect(AGENT_CARDS.reviewer.supportedWorkerTypes).toContain(wt);
      expect(AGENT_CARDS.reporter.supportedWorkerTypes).toContain(wt);
    }
  });
});

describe('agentRoleForWorkerType', () => {
  it('maps navigation to scout', () => {
    expect(agentRoleForWorkerType('navigation')).toBe('scout');
  });

  it('maps form to tester', () => {
    expect(agentRoleForWorkerType('form')).toBe('tester');
  });

  it('maps crud to tester', () => {
    expect(agentRoleForWorkerType('crud')).toBe('tester');
  });

  it('maps api to tester', () => {
    expect(agentRoleForWorkerType('api')).toBe('tester');
  });

  it('maps adversarial to security', () => {
    expect(agentRoleForWorkerType('adversarial')).toBe('security');
  });
});

describe('agentCardForWorkerType', () => {
  it('returns the scout card for navigation', () => {
    const card = agentCardForWorkerType('navigation');
    expect(card.role).toBe('scout');
    expect(card.id).toBe('agent-scout');
  });

  it('returns the tester card for form', () => {
    const card = agentCardForWorkerType('form');
    expect(card.role).toBe('tester');
    expect(card.id).toBe('agent-tester');
  });

  it('returns the security card for adversarial', () => {
    const card = agentCardForWorkerType('adversarial');
    expect(card.role).toBe('security');
    expect(card.id).toBe('agent-security');
  });
});

describe('findCapableAgents', () => {
  it('returns scout and reviewer and reporter for navigation', () => {
    const agents = findCapableAgents('navigation');
    const roles = agents.map((a) => a.role);
    expect(roles).toContain('scout');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('reporter');
  });

  it('returns tester, reviewer, and reporter for form', () => {
    const agents = findCapableAgents('form');
    const roles = agents.map((a) => a.role);
    expect(roles).toContain('tester');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('reporter');
    expect(roles).not.toContain('scout');
  });

  it('returns security, reviewer, and reporter for adversarial', () => {
    const agents = findCapableAgents('adversarial');
    const roles = agents.map((a) => a.role);
    expect(roles).toContain('security');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('reporter');
    expect(roles).not.toContain('scout');
    expect(roles).not.toContain('tester');
  });
});
