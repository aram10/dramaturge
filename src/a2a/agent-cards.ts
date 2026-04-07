/**
 * Pre-defined Agent Cards for the multi-agent orchestration team.
 *
 * Each card describes a specialized agent's capabilities so the
 * Coordinator can match incoming tasks to the best-fit agent.
 */

import type { AgentCard, AgentRole } from './types.js';
import type { WorkerType } from '../types.js';

const PROTOCOL_VERSION = '0.1.0';

const scoutCard: AgentCard = {
  id: 'agent-scout',
  name: 'Scout Agent',
  description:
    'Rapidly maps the application surface area, discovering routes and classifying pages.',
  role: 'scout',
  skills: [
    {
      id: 'route-discovery',
      name: 'Route Discovery',
      description: 'Discover navigation targets and map the page graph.',
      workerTypes: ['navigation'],
      tags: ['navigation', 'discovery', 'mapping'],
    },
  ],
  supportedWorkerTypes: ['navigation'],
  protocolVersion: PROTOCOL_VERSION,
};

const testerCard: AgentCard = {
  id: 'agent-tester',
  name: 'Tester Agent',
  description:
    'Deep-dives into specific flows (forms, CRUD, state transitions) with domain-specific reasoning.',
  role: 'tester',
  skills: [
    {
      id: 'form-testing',
      name: 'Form Testing',
      description: 'Test form validation, submission, edge cases and error states.',
      workerTypes: ['form'],
      tags: ['form', 'validation', 'input'],
    },
    {
      id: 'crud-testing',
      name: 'CRUD Testing',
      description: 'Test create/read/update/delete flows including list views and detail pages.',
      workerTypes: ['crud'],
      tags: ['crud', 'list', 'detail', 'data'],
    },
    {
      id: 'api-testing',
      name: 'API Testing',
      description: 'Probe API endpoints for contract compliance and auth boundaries.',
      workerTypes: ['api'],
      tags: ['api', 'contract', 'endpoint'],
    },
  ],
  supportedWorkerTypes: ['form', 'crud', 'api'],
  protocolVersion: PROTOCOL_VERSION,
};

const securityCard: AgentCard = {
  id: 'agent-security',
  name: 'Security Agent',
  description:
    'Runs adversarial scenarios with security-domain knowledge (OWASP patterns, auth boundary probing).',
  role: 'security',
  skills: [
    {
      id: 'adversarial-probing',
      name: 'Adversarial Probing',
      description:
        'Probe for stale-state, replay, idempotency, and boundary-value vulnerabilities.',
      workerTypes: ['adversarial'],
      tags: ['adversarial', 'security', 'owasp', 'boundary'],
    },
  ],
  supportedWorkerTypes: ['adversarial'],
  protocolVersion: PROTOCOL_VERSION,
};

const reviewerCard: AgentCard = {
  id: 'agent-reviewer',
  name: 'Reviewer Agent',
  description: 'Observes other agents in real-time and redirects them toward suspicious behaviors.',
  role: 'reviewer',
  skills: [
    {
      id: 'finding-review',
      name: 'Finding Review',
      description: 'Review findings from other agents, validate severity, and suggest follow-ups.',
      workerTypes: ['navigation', 'form', 'crud', 'api', 'adversarial'],
      tags: ['review', 'judge', 'validation'],
    },
  ],
  supportedWorkerTypes: ['navigation', 'form', 'crud', 'api', 'adversarial'],
  protocolVersion: PROTOCOL_VERSION,
};

const reporterCard: AgentCard = {
  id: 'agent-reporter',
  name: 'Reporter Agent',
  description: 'Synthesizes findings across all agents into coherent narratives.',
  role: 'reporter',
  skills: [
    {
      id: 'finding-synthesis',
      name: 'Finding Synthesis',
      description: 'Aggregate and deduplicate findings, produce summary narratives.',
      workerTypes: ['navigation', 'form', 'crud', 'api', 'adversarial'],
      tags: ['report', 'synthesis', 'summary'],
    },
  ],
  supportedWorkerTypes: ['navigation', 'form', 'crud', 'api', 'adversarial'],
  protocolVersion: PROTOCOL_VERSION,
};

/** All pre-defined agent cards, keyed by role. */
export const AGENT_CARDS: Record<AgentRole, AgentCard> = {
  scout: scoutCard,
  tester: testerCard,
  security: securityCard,
  reviewer: reviewerCard,
  reporter: reporterCard,
};

/** Map a worker type to the best-fit agent role. */
export function agentRoleForWorkerType(workerType: WorkerType): AgentRole {
  switch (workerType) {
    case 'navigation':
      return 'scout';
    case 'form':
    case 'crud':
    case 'api':
      return 'tester';
    case 'adversarial':
      return 'security';
  }
}

/**
 * Retrieve the agent card that best matches a worker type.
 */
export function agentCardForWorkerType(workerType: WorkerType): AgentCard {
  return AGENT_CARDS[agentRoleForWorkerType(workerType)];
}

/**
 * Find all agent cards whose skills cover the given worker type.
 */
export function findCapableAgents(workerType: WorkerType): AgentCard[] {
  return Object.values(AGENT_CARDS).filter((card) =>
    card.supportedWorkerTypes.includes(workerType)
  );
}
