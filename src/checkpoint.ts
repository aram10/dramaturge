import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Checkpoint,
  RawFinding,
  Evidence,
  ReplayableAction,
  BlindSpot,
  FrontierItem,
} from "./types.js";
import type { StateGraph } from "./graph/state-graph.js";
import type { FrontierQueue } from "./graph/frontier.js";
import type { CoverageTracker } from "./coverage/tracker.js";

const CHECKPOINT_FILE = "checkpoint.json";

interface SaveCheckpointOptions {
  frontierSnapshot?: FrontierItem[];
}

export function saveCheckpoint(
  outputDir: string,
  graph: StateGraph,
  frontier: FrontierQueue,
  findingsByNode: Map<string, RawFinding[]>,
  evidenceByNode: Map<string, Evidence[]>,
  actionsByNode: Map<string, ReplayableAction[]>,
  coverage: CoverageTracker,
  completedTaskIds: string[],
  tasksExecuted: number,
  plannerState: Record<string, FrontierItem["workerType"][]>,
  options?: SaveCheckpointOptions
): void {
  const checkpoint: Checkpoint = {
    version: 1,
    savedAt: new Date().toISOString(),
    tasksExecuted,
    graphSnapshot: {
      nodes: graph.getAllNodes(),
      edges: graph.getAllEdges(),
    },
    frontierSnapshot:
      options?.frontierSnapshot?.map((item) => ({ ...item })) ??
      frontier.snapshot(),
    findingsByNode: Object.fromEntries(findingsByNode.entries()),
    evidenceByNode: Object.fromEntries(evidenceByNode.entries()),
    actionsByNode: Object.fromEntries(actionsByNode.entries()),
    blindSpots: coverage.getBlindSpots(),
    completedTaskIds,
    plannerState,
  };

  const path = join(outputDir, CHECKPOINT_FILE);
  writeFileSync(path, JSON.stringify(checkpoint), "utf-8");
}

export function loadCheckpoint(runDir: string): Checkpoint | null {
  const path = join(runDir, CHECKPOINT_FILE);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, "utf-8");
  let data: Checkpoint;
  try {
    data = JSON.parse(raw) as Checkpoint;
  } catch {
    throw new Error(`Failed to parse checkpoint JSON: ${path}`);
  }
  if (data.version !== 1) {
    throw new Error(`Unsupported checkpoint version: ${data.version}`);
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
  plannerState: Record<string, FrontierItem["workerType"][]>;
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
  const pendingItems = checkpoint.frontierSnapshot.filter(
    (i) => i.status === "pending"
  );
  frontier.enqueueMany(pendingItems);

  // Restore blind spots
  for (const spot of checkpoint.blindSpots) {
    coverage.addBlindSpot(spot);
  }

  // Restore findings + evidence maps
  const findingsByNode = new Map<string, RawFinding[]>();
  for (const [nodeId, findings] of Object.entries(checkpoint.findingsByNode)) {
    findingsByNode.set(nodeId, findings);
  }

  const evidenceByNode = new Map<string, Evidence[]>();
  for (const [nodeId, evidence] of Object.entries(checkpoint.evidenceByNode)) {
    evidenceByNode.set(nodeId, evidence);
  }

  const actionsByNode = new Map<string, ReplayableAction[]>();
  for (const [nodeId, actions] of Object.entries(checkpoint.actionsByNode ?? {})) {
    actionsByNode.set(nodeId, actions);
  }

  return {
    findingsByNode,
    evidenceByNode,
    actionsByNode,
    completedTaskIds: new Set(checkpoint.completedTaskIds),
    tasksExecuted: checkpoint.tasksExecuted,
    plannerState: checkpoint.plannerState ?? {},
  };
}
