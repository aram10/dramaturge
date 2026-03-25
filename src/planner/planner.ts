import { randomUUID } from "node:crypto";
import type {
  StateNode,
  FrontierItem,
  FollowupRequest,
  WorkerType,
  MissionConfig,
  PageType,
} from "../types.js";
import type { StateGraph } from "../graph/state-graph.js";
import { computePriority, type PriorityContext } from "./priority.js";

/** Default page-type → worker-type mapping. */
const PAGE_TYPE_WORKER_MAP: Record<PageType, WorkerType> = {
  form: "form",
  list: "crud",
  detail: "crud",
  dashboard: "navigation",
  settings: "form",
  wizard: "form",
  modal: "form",
  auth: "navigation",
  landing: "navigation",
  unknown: "navigation",
};

interface PlannerProposal {
  workerType: WorkerType;
  objective: string;
  reason: string;
}

export class Planner {
  private workerTypesPerNode = new Map<string, Set<WorkerType>>();

  /**
   * Propose tasks for a newly discovered state node.
   * Uses the deterministic page-type→worker mapping.
   * The LLM-assisted version will be added in a follow-up — for Phase 2A,
   * we use the deterministic mapping only to validate the engine loop
   * before adding the LLM dependency.
   */
  proposeTasks(
    node: StateNode,
    _graph: StateGraph,
    mission?: MissionConfig
  ): FrontierItem[] {
    const proposals: PlannerProposal[] = [];

    // Default worker for the page type
    const defaultWorker = PAGE_TYPE_WORKER_MAP[node.pageType];

    // Filter by focus modes if configured
    const allowedTypes: WorkerType[] = mission?.focusModes ?? [
      "navigation",
      "form",
      "crud",
    ];

    if (allowedTypes.includes(defaultWorker)) {
      proposals.push({
        workerType: defaultWorker,
        objective: `Explore ${node.pageType} page${node.url ? ` at ${node.url}` : ""}: ${node.title ?? "untitled"}`,
        reason: `Auto-assigned ${defaultWorker} worker for ${node.pageType} page`,
      });
    }

    // For non-navigation pages, also add a navigation task to discover links
    if (
      defaultWorker !== "navigation" &&
      allowedTypes.includes("navigation") &&
      node.timesVisited === 0
    ) {
      proposals.push({
        workerType: "navigation",
        objective: `Discover navigation targets from ${node.pageType} page${node.url ? ` at ${node.url}` : ""}`,
        reason: "Navigation discovery for new page",
      });
    }

    const priorityCtx: PriorityContext = {
      visitedWorkerTypes:
        this.workerTypesPerNode.get(node.id) ?? new Set(),
    };

    return proposals.map((p) => ({
      id: `task-${randomUUID().slice(0, 8)}`,
      nodeId: node.id,
      workerType: p.workerType,
      objective: p.objective,
      priority: computePriority(node, p.workerType, priorityCtx),
      reason: p.reason,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    }));
  }

  /**
   * Record that a worker type has been dispatched for a node.
   */
  recordDispatch(nodeId: string, workerType: WorkerType): void {
    const set = this.workerTypesPerNode.get(nodeId) ?? new Set();
    set.add(workerType);
    this.workerTypesPerNode.set(nodeId, set);
  }

  /**
   * Convert a follow-up request from a worker into a frontier item.
   */
  routeFollowup(
    request: FollowupRequest,
    sourceNodeId: string
  ): FrontierItem {
    return {
      id: `task-${randomUUID().slice(0, 8)}`,
      nodeId: request.targetNodeId ?? sourceNodeId,
      workerType: request.type,
      objective: request.reason,
      priority: 0.8,
      reason: `Follow-up from finding: ${request.relatedFindingId ?? "general"}`,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
  }
}
