// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Checkpoint, RawFinding, Evidence, ReplayableAction, FrontierItem } from './types.js';
import type { StateGraph } from './graph/state-graph.js';
import type { FrontierQueue } from './graph/frontier.js';
import type { CoverageTracker } from './coverage/tracker.js';

const CHECKPOINT_FILE = 'checkpoint.json';

const findingCategorySchema = z.enum([
  'Bug',
  'UX Concern',
  'Accessibility Issue',
  'Performance Issue',
  'Visual Glitch',
]);

const findingSeveritySchema = z.enum(['Critical', 'Major', 'Minor', 'Trivial']);
const findingSourceSchema = z.enum(['agent', 'auto-capture', 'confirmed']);
const findingConfidenceSchema = z.enum(['low', 'medium', 'high']);
const pageTypeSchema = z.enum([
  'landing',
  'dashboard',
  'list',
  'detail',
  'form',
  'wizard',
  'settings',
  'modal',
  'auth',
  'unknown',
]);
const workerTypeSchema = z.enum(['navigation', 'form', 'crud', 'api', 'adversarial']);
const frontierItemStatusSchema = z.enum(['pending', 'in-progress', 'completed', 'blocked']);
const replayableActionKindSchema = z.enum([
  'navigate',
  'click',
  'input',
  'submit',
  'toggle',
  'open',
  'close',
  'keydown',
  'screenshot',
  'discover-edge',
]);
const replayableActionStatusSchema = z.enum(['worked', 'blocked', 'error', 'unclear', 'recorded']);
const blindSpotReasonSchema = z.enum([
  'blocked',
  'time-budget',
  'pruned',
  'state-unreachable',
  'unknown',
]);
const blindSpotSeveritySchema = z.enum(['low', 'medium', 'high']);
const evidenceTypeSchema = z.enum([
  'screenshot',
  'console-error',
  'network-error',
  'accessibility-scan',
  'visual-diff',
  'api-contract',
  'vision-analysis',
]);

const findingMetaSchema = z
  .object({
    source: findingSourceSchema,
    confidence: findingConfidenceSchema,
    repro: z
      .object({
        stateId: z.string().optional(),
        route: z.string().optional(),
        objective: z.string(),
        breadcrumbs: z.array(z.string()),
        actionIds: z.array(z.string()).optional(),
        evidenceIds: z.array(z.string()),
      })
      .optional(),
  })
  .optional();

const findingVerdictSchema = z
  .object({
    hypothesis: z.string(),
    observation: z.string(),
    evidenceChain: z.array(z.string()),
    alternativesConsidered: z.array(z.string()),
    suggestedVerification: z.array(z.string()),
  })
  .optional();

const rawFindingSchema = z.object({
  ref: z.string().optional(),
  category: findingCategorySchema,
  severity: findingSeveritySchema,
  title: z.string(),
  stepsToReproduce: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  screenshotRef: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  verdict: findingVerdictSchema,
  meta: findingMetaSchema,
});

const evidenceSchema = z.object({
  id: z.string(),
  type: evidenceTypeSchema,
  summary: z.string(),
  path: z.string().optional(),
  timestamp: z.string(),
  areaName: z.string().optional(),
  relatedFindingIds: z.array(z.string()),
});

const replayableActionSchema = z.object({
  id: z.string(),
  kind: replayableActionKindSchema,
  summary: z.string(),
  source: z.enum(['page', 'worker-tool']),
  status: replayableActionStatusSchema,
  timestamp: z.string(),
  selector: z.string().optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  redacted: z.boolean().optional(),
  key: z.string().optional(),
});

const blindSpotSchema = z.object({
  nodeId: z.string().optional(),
  summary: z.string(),
  reason: blindSpotReasonSchema,
  severity: blindSpotSeveritySchema,
});

const navigationHintSchema = z.object({
  url: z.string().optional(),
  selector: z.string().optional(),
  actionDescription: z.string().optional(),
});

const pageFingerprintSchema = z.object({
  normalizedPath: z.string(),
  signature: z.object({
    pathname: z.string(),
    query: z.array(z.tuple([z.string(), z.string()])),
    uiMarkers: z.array(z.string()),
  }),
  title: z.string(),
  heading: z.string(),
  dialogTitles: z.array(z.string()),
  hash: z.string(),
});

const stateNodeSchema = z.object({
  id: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  fingerprint: pageFingerprintSchema,
  pageType: pageTypeSchema,
  depth: z.number(),
  firstSeenAt: z.string(),
  controlsDiscovered: z.array(z.string()),
  controlsExercised: z.array(z.string()),
  navigationHint: navigationHintSchema.optional(),
  parentEdgeId: z.string().optional(),
  tags: z.array(z.string()),
  riskScore: z.number(),
  timesVisited: z.number(),
});

const stateEdgeSchema = z.object({
  id: z.string(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  actionLabel: z.string(),
  navigationHint: navigationHintSchema,
  outcome: z.enum(['success', 'blocked', 'error', 'same-state']),
  timestamp: z.string(),
});

const frontierItemSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  workerType: workerTypeSchema,
  objective: z.string(),
  priority: z.number(),
  reason: z.string(),
  retryCount: z.number(),
  createdAt: z.string(),
  status: frontierItemStatusSchema,
});

const checkpointSchema = z.object({
  version: z.literal(1),
  savedAt: z.string(),
  tasksExecuted: z.number(),
  graphSnapshot: z.object({
    nodes: z.array(stateNodeSchema),
    edges: z.array(stateEdgeSchema),
  }),
  frontierSnapshot: z.array(frontierItemSchema),
  findingsByNode: z.record(z.string(), z.array(rawFindingSchema)),
  evidenceByNode: z.record(z.string(), z.array(evidenceSchema)),
  actionsByNode: z.record(z.string(), z.array(replayableActionSchema)).optional(),
  blindSpots: z.array(blindSpotSchema),
  completedTaskIds: z.array(z.string()),
  plannerState: z.record(z.string(), z.array(workerTypeSchema)).optional(),
});

export interface SaveCheckpointOptions {
  frontierSnapshot?: FrontierItem[];
}

export interface SaveCheckpointInput {
  outputDir: string;
  graph: StateGraph;
  frontier: FrontierQueue;
  findingsByNode: Map<string, RawFinding[]>;
  evidenceByNode: Map<string, Evidence[]>;
  actionsByNode: Map<string, ReplayableAction[]>;
  coverage: CoverageTracker;
  completedTaskIds: string[];
  tasksExecuted: number;
  plannerState: Record<string, FrontierItem['workerType'][]>;
  options?: SaveCheckpointOptions;
}

export function saveCheckpoint(input: SaveCheckpointInput): void {
  const {
    outputDir,
    graph,
    frontier,
    findingsByNode,
    evidenceByNode,
    actionsByNode,
    coverage,
    completedTaskIds,
    tasksExecuted,
    plannerState,
    options,
  } = input;
  const checkpoint: Checkpoint = {
    version: 1,
    savedAt: new Date().toISOString(),
    tasksExecuted,
    graphSnapshot: {
      nodes: graph.getAllNodes(),
      edges: graph.getAllEdges(),
    },
    frontierSnapshot:
      options?.frontierSnapshot?.map((item) => ({ ...item })) ?? frontier.snapshot(),
    findingsByNode: Object.fromEntries(findingsByNode.entries()),
    evidenceByNode: Object.fromEntries(evidenceByNode.entries()),
    actionsByNode: Object.fromEntries(actionsByNode.entries()),
    blindSpots: coverage.getBlindSpots(),
    completedTaskIds,
    plannerState,
  };

  const path = join(outputDir, CHECKPOINT_FILE);
  writeFileSync(path, JSON.stringify(checkpoint), 'utf-8');
}

export function loadCheckpoint(runDir: string): Checkpoint | null {
  const path = join(runDir, CHECKPOINT_FILE);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, 'utf-8');
  let data: Checkpoint;
  try {
    data = checkpointSchema.parse(JSON.parse(raw)) as Checkpoint;
  } catch {
    throw new Error(`Failed to parse or validate checkpoint JSON: ${path}`);
  }
  return data;
}

/** Hydrate graph, frontier, and coverage from a checkpoint; returns findings/evidence maps. */
export function hydrateFromCheckpoint(
  checkpoint: Checkpoint,
  graph: StateGraph,
  frontier: FrontierQueue,
  coverage: CoverageTracker
): {
  findingsByNode: Map<string, RawFinding[]>;
  evidenceByNode: Map<string, Evidence[]>;
  actionsByNode: Map<string, ReplayableAction[]>;
  completedTaskIds: Set<string>;
  tasksExecuted: number;
  plannerState: Record<string, FrontierItem['workerType'][]>;
} {
  // Restore graph nodes
  for (const node of checkpoint.graphSnapshot.nodes) {
    graph.restoreNode(node);
  }
  // Restore graph edges
  for (const edge of checkpoint.graphSnapshot.edges) {
    graph.restoreEdge(edge);
  }

  // Restore frontier (only pending items)
  const pendingItems = checkpoint.frontierSnapshot.filter((i) => i.status === 'pending');
  frontier.enqueueMany(pendingItems);

  // Restore blind spots
  for (const spot of checkpoint.blindSpots) {
    coverage.addBlindSpot(spot);
  }

  return {
    findingsByNode: new Map(Object.entries(checkpoint.findingsByNode)),
    evidenceByNode: new Map(Object.entries(checkpoint.evidenceByNode)),
    actionsByNode: checkpoint.actionsByNode
      ? new Map<string, ReplayableAction[]>(Object.entries(checkpoint.actionsByNode))
      : new Map<string, ReplayableAction[]>(),
    completedTaskIds: new Set(checkpoint.completedTaskIds),
    tasksExecuted: checkpoint.tasksExecuted,
    plannerState: checkpoint.plannerState ?? {},
  };
}
