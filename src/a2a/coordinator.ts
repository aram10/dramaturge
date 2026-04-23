// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Coordinator — multi-agent task assignment and orchestration.
 *
 * Extends the Planner to route tasks to specialized agents based on
 * their Agent Cards. The Coordinator maintains agent state, tracks
 * task status per the A2A Task lifecycle, and mediates inter-agent
 * communication via the Blackboard and MessageBus.
 */

import { AGENT_CARDS, agentRoleForWorkerType } from './agent-cards.js';
import type { Blackboard } from './blackboard.js';
import type { MessageBus } from './message-bus.js';
import type { AgentCard, AgentRole, A2ATask, A2ATaskStatus, A2AMessage } from './types.js';
import type {
  FrontierItem,
  FollowupRequest,
  MissionConfig,
  StateNode,
  WorkerType,
} from '../types.js';
import { shortId } from '../constants.js';
import { Planner } from '../planner/planner.js';
import type { RepoHints } from '../adaptation/types.js';
import type { StateGraph } from '../graph/state-graph.js';
import type { PlannerMemorySignals } from '../memory/types.js';
import type { DiffContext } from '../diff/types.js';

export interface CoordinatorDeps {
  blackboard: Blackboard;
  messageBus: MessageBus;
}

/**
 * The Coordinator extends the base Planner with multi-agent awareness.
 *
 * It wraps the existing deterministic/LLM planning logic and adds:
 * 1. Agent capability matching — tasks are tagged with the best-fit agent
 * 2. Task lifecycle tracking per the A2A Task model
 * 3. Blackboard posting — task assignments and completions are recorded
 * 4. Reviewer notification — findings and suspicious signals are broadcast
 */
export class Coordinator {
  private deps: CoordinatorDeps;
  private activeTasks = new Map<string, A2ATask>();
  private agents: ReadonlyMap<AgentRole, AgentCard>;
  private planner: Planner;

  constructor(deps: CoordinatorDeps) {
    this.deps = deps;
    this.agents = new Map(Object.entries(AGENT_CARDS) as [AgentRole, AgentCard][]);
    this.planner = new Planner();
  }

  get diffPriorityBoost(): number {
    return this.planner.diffPriorityBoost;
  }

  set diffPriorityBoost(value: number) {
    this.planner.diffPriorityBoost = value;
  }

  /** Get the agent card for a given role. */
  getAgent(role: AgentRole): AgentCard | undefined {
    return this.agents.get(role);
  }

  /** List all registered agent cards. */
  listAgents(): AgentCard[] {
    return [...this.agents.values()];
  }

  /**
   * Assign a frontier item to the best-fit agent and create an A2A task.
   *
   * Returns the A2ATask wrapping the frontier item. The engine should
   * still execute the task via the existing worker infrastructure —
   * the A2ATask provides coordination metadata on top.
   */
  assignTask(item: FrontierItem): A2ATask {
    const role = agentRoleForWorkerType(item.workerType);
    const card = this.agents.get(role);
    if (!card) {
      throw new Error(`No registered agent for role: ${role}`);
    }

    const task: A2ATask = {
      id: `a2a-${shortId()}`,
      assignedAgent: card.id,
      status: 'submitted',
      messages: [],
      artifacts: [],
      history: [
        {
          status: 'submitted',
          timestamp: new Date().toISOString(),
        },
      ],
      metadata: {
        frontierItemId: item.id,
        workerType: item.workerType,
        nodeId: item.nodeId,
        objective: item.objective,
      },
    };

    this.activeTasks.set(task.id, task);

    // Post assignment to blackboard
    this.deps.blackboard.post(
      'directive',
      'coordinator',
      {
        type: 'task-assigned',
        taskId: task.id,
        agentId: card.id,
        agentRole: role,
        workerType: item.workerType,
        objective: item.objective,
      },
      [role, item.workerType]
    );

    // Notify the assigned agent
    this.deps.messageBus.sendText('coordinator', card.id, `Task assigned: ${item.objective}`, {
      role: 'coordinator',
      metadata: { a2aTaskId: task.id, workerType: item.workerType },
    });

    return task;
  }

  /**
   * Update task status through the A2A lifecycle.
   */
  updateTaskStatus(taskId: string, status: A2ATaskStatus, message?: A2AMessage): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.status = status;
    task.history.push({
      status,
      timestamp: new Date().toISOString(),
      message,
    });

    if (message) {
      task.messages.push(message);
    }

    // Post status change to blackboard
    this.deps.blackboard.post(
      'directive',
      'coordinator',
      {
        type: 'task-status-update',
        taskId,
        status,
        agentId: task.assignedAgent,
      },
      [status]
    );
  }

  /**
   * Record a completed task and post findings to the blackboard
   * for the Reviewer and Reporter agents to observe.
   */
  completeTask(taskId: string, summary: string, findingsCount: number): void {
    this.updateTaskStatus(taskId, 'completed');

    const task = this.activeTasks.get(taskId);
    if (!task) return;

    // Post completion summary to blackboard
    this.deps.blackboard.post(
      'finding',
      task.assignedAgent,
      {
        type: 'task-completed',
        taskId,
        summary,
        findingsCount,
      },
      ['completed']
    );

    // Notify the reviewer if findings were detected
    if (findingsCount > 0) {
      this.deps.messageBus.sendText(
        task.assignedAgent,
        AGENT_CARDS.reviewer.id,
        `Task ${taskId} completed with ${findingsCount} finding(s): ${summary}`,
        { metadata: { taskId, findingsCount } }
      );
    }
  }

  /**
   * Broadcast a directive to all agents. Used by the Reviewer to redirect
   * agent focus based on observed patterns.
   */
  broadcastDirective(fromAgentId: string, text: string, metadata?: Record<string, unknown>): void {
    this.deps.messageBus.sendText(fromAgentId, '*', text, {
      role: fromAgentId === 'coordinator' ? 'coordinator' : 'agent',
      metadata,
    });

    this.deps.blackboard.post(
      'directive',
      fromAgentId,
      {
        ...metadata,
        type: 'broadcast',
        text,
      },
      ['broadcast']
    );
  }

  /** Get an active task by its A2A task id. */
  getTask(taskId: string): A2ATask | undefined {
    return this.activeTasks.get(taskId);
  }

  /** Get all active tasks. */
  getActiveTasks(): A2ATask[] {
    return [...this.activeTasks.values()].filter(
      (t) => t.status !== 'completed' && t.status !== 'failed' && t.status !== 'canceled'
    );
  }

  /** Resolve the agent role for a given worker type. */
  resolveAgentRole(workerType: WorkerType): AgentRole {
    return agentRoleForWorkerType(workerType);
  }

  proposeTasks(
    node: StateNode,
    graph: StateGraph,
    mission?: MissionConfig,
    repoHints?: RepoHints,
    memorySignals?: PlannerMemorySignals,
    diffContext?: DiffContext
  ): FrontierItem[] {
    return this.planner.proposeTasks(node, graph, mission, repoHints, memorySignals, diffContext);
  }

  async proposeTasksWithLLM(
    node: StateNode,
    graph: StateGraph,
    plannerModel: string,
    mission?: MissionConfig,
    repoHints?: RepoHints,
    llmRequestTimeoutMs?: number,
    memorySignals?: PlannerMemorySignals,
    diffContext?: DiffContext
  ): Promise<FrontierItem[]> {
    return this.planner.proposeTasksWithLLM(
      node,
      graph,
      plannerModel,
      mission,
      repoHints,
      llmRequestTimeoutMs,
      memorySignals,
      diffContext
    );
  }

  recordDispatch(nodeId: string, workerType: WorkerType): void {
    this.planner.recordDispatch(nodeId, workerType);
  }

  snapshotDispatchState(): Record<string, WorkerType[]> {
    return this.planner.snapshotDispatchState();
  }

  restoreDispatchState(snapshot: Record<string, WorkerType[]>): void {
    this.planner.restoreDispatchState(snapshot);
  }

  routeFollowup(request: FollowupRequest, sourceNodeId: string): FrontierItem {
    return this.planner.routeFollowup(request, sourceNodeId);
  }
}
