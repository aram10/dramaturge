// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { MissionConfig } from '../types.js';
import type { RepoHints } from '../adaptation/types.js';
import { FrontierQueue } from '../graph/frontier.js';
import { StateGraph } from '../graph/state-graph.js';
import type { Planner } from '../planner/planner.js';
import type { Coordinator } from '../a2a/coordinator.js';
import type { MemoryStore } from './store.js';
import type { NavigationMemorySnapshot } from './types.js';

export interface SeedGraphFromNavigationMemoryInput {
  graph: StateGraph;
  frontier: FrontierQueue;
  /** Planner or Coordinator (when A2A is enabled). Coordinator implements a planner-compatible API used here. */
  planner: Planner | Coordinator;
  snapshot: NavigationMemorySnapshot;
  mission?: MissionConfig;
  repoHints?: RepoHints;
  memoryStore?: MemoryStore;
}

export interface SeedGraphFromNavigationMemoryResult {
  restoredNodeCount: number;
  restoredEdgeCount: number;
  seededTaskCount: number;
}

export function seedGraphFromNavigationMemory(
  input: SeedGraphFromNavigationMemoryInput
): SeedGraphFromNavigationMemoryResult {
  const { graph, frontier, planner, snapshot, mission, repoHints, memoryStore } = input;

  for (const node of snapshot.nodes) {
    graph.restoreNode(node);
  }
  for (const edge of snapshot.edges) {
    graph.restoreEdge(edge);
  }

  const candidateNodes = graph
    .getAllNodes()
    .filter(
      (node) =>
        node.depth === 0 ||
        node.timesVisited === 0 ||
        node.controlsExercised.length < node.controlsDiscovered.length
    )
    .sort((a, b) => {
      const depthDiff = a.depth - b.depth;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      const coverageGapA = a.controlsDiscovered.length - a.controlsExercised.length;
      const coverageGapB = b.controlsDiscovered.length - b.controlsExercised.length;
      if (coverageGapA !== coverageGapB) {
        return coverageGapB - coverageGapA;
      }
      return a.timesVisited - b.timesVisited;
    });

  let seededTaskCount = 0;
  for (const node of candidateNodes) {
    const tasks = planner.proposeTasks(
      node,
      graph,
      mission,
      repoHints,
      memoryStore?.getPlannerSignals(node)
    );
    seededTaskCount += tasks.length;
    frontier.enqueueMany(tasks);
  }

  return {
    restoredNodeCount: snapshot.nodes.length,
    restoredEdgeCount: snapshot.edges.length,
    seededTaskCount,
  };
}
