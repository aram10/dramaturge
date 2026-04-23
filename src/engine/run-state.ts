// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { loadCheckpoint, hydrateFromCheckpoint } from '../checkpoint.js';
import { captureFingerprint } from '../graph/fingerprint.js';
import { seedGraphFromNavigationMemory } from '../memory/navigation-cache.js';
import { classifyPage } from '../planner/page-classifier.js';
import type { FrontierItem, StateNode } from '../types.js';
import type { EngineContext } from './context.js';
import { assignPageNodeOwner } from './graph-ops.js';

export interface WarmStartState {
  warmStartApplied: boolean;
  warmStartRestoredStateCount: number;
}

function findRootNode(ctx: EngineContext): StateNode | undefined {
  return ctx.graph.getAllNodes().find((node) => node.depth === 0) ?? ctx.graph.getAllNodes()[0];
}

export function restoreCheckpointState(ctx: EngineContext, resumeDir: string | undefined): number {
  if (!resumeDir) {
    return 0;
  }

  const checkpoint = loadCheckpoint(resumeDir);
  if (!checkpoint) {
    return 0;
  }

  const hydrated = hydrateFromCheckpoint(checkpoint, ctx.graph, ctx.frontier, ctx.globalCoverage);
  ctx.findingsByNode = hydrated.findingsByNode;
  ctx.evidenceByNode = hydrated.evidenceByNode;
  ctx.actionsByNode = hydrated.actionsByNode;
  ctx.completedTaskIds = hydrated.completedTaskIds;
  ctx.planner.restoreDispatchState(hydrated.plannerState);

  ctx.logger?.info('Resumed from checkpoint', {
    tasksExecuted: hydrated.tasksExecuted,
    states: ctx.graph.nodeCount(),
    pendingTasks: ctx.frontier.size(),
  });
  return hydrated.tasksExecuted;
}

export function applyWarmStart(ctx: EngineContext, resumeDir?: string): WarmStartState {
  const memoryStore = ctx.memoryStore;
  const shouldSkipWarmStart =
    Boolean(resumeDir) || ctx.graph.nodeCount() > 0 || !memoryStore || !ctx.config.memory.warmStart;
  if (shouldSkipWarmStart) {
    return {
      warmStartApplied: false,
      warmStartRestoredStateCount: 0,
    };
  }

  const navigationSnapshot = memoryStore.getNavigationSnapshot(ctx.config.targetUrl);
  if (!navigationSnapshot) {
    return {
      warmStartApplied: false,
      warmStartRestoredStateCount: 0,
    };
  }

  const warmStart = seedGraphFromNavigationMemory({
    graph: ctx.graph,
    frontier: ctx.frontier,
    planner: ctx.planner,
    snapshot: navigationSnapshot,
    mission: ctx.mission,
    repoHints: ctx.repoHints,
    memoryStore,
  });
  ctx.logger?.info('Applied warm start snapshot', {
    restoredNodes: warmStart.restoredNodeCount,
    restoredEdges: warmStart.restoredEdgeCount,
    seededTasks: warmStart.seededTaskCount,
  });
  return {
    warmStartApplied: warmStart.restoredNodeCount > 0,
    warmStartRestoredStateCount: warmStart.restoredNodeCount,
  };
}

async function proposeSeedTasks(
  ctx: EngineContext,
  node: StateNode,
  useLLMPlanner: boolean
): Promise<FrontierItem[]> {
  if (useLLMPlanner) {
    return ctx.planner.proposeTasksWithLLM(
      node,
      ctx.graph,
      ctx.config.models.planner,
      ctx.mission,
      ctx.repoHints,
      ctx.config.llm.requestTimeoutMs,
      ctx.memoryStore?.getPlannerSignals(node),
      ctx.diffContext
    );
  }

  return ctx.planner.proposeTasks(
    node,
    ctx.graph,
    ctx.mission,
    ctx.repoHints,
    ctx.memoryStore?.getPlannerSignals(node),
    ctx.diffContext
  );
}

export async function seedFrontierIfNeeded(
  ctx: EngineContext,
  useLLMPlanner: boolean
): Promise<void> {
  if (ctx.graph.nodeCount() === 0) {
    await ctx.page.goto(ctx.config.targetUrl);
    const rootFingerprint = await captureFingerprint(ctx.page);
    const rootPageType = await classifyPage(ctx.page);
    const rootNode = ctx.graph.addNode({
      url: ctx.config.targetUrl,
      title: rootFingerprint.title,
      fingerprint: rootFingerprint,
      pageType: rootPageType,
      depth: 0,
    });
    assignPageNodeOwner(ctx, 'primary', rootNode.id);

    const seedTasks = await proposeSeedTasks(ctx, rootNode, useLLMPlanner);
    ctx.frontier.enqueueMany(seedTasks);
    ctx.logger?.info('Seeded frontier from root state', {
      pageType: rootPageType,
      fingerprint: rootFingerprint.hash,
      tasks: seedTasks.length,
    });
  } else if (ctx.frontier.size() === 0) {
    const rootNode = findRootNode(ctx);
    if (rootNode) {
      assignPageNodeOwner(ctx, 'primary', rootNode.id);
      const seedTasks = await proposeSeedTasks(ctx, rootNode, useLLMPlanner);
      ctx.frontier.enqueueMany(seedTasks);
      ctx.logger?.info('Seeded frontier from existing root state', {
        nodeId: rootNode.id,
        tasks: seedTasks.length,
      });
    }
  }

  const existingRootNode = findRootNode(ctx);
  if (existingRootNode) {
    assignPageNodeOwner(ctx, 'primary', existingRootNode.id);
  }
}
