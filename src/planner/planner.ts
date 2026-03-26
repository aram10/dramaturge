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
import { proposeLLMTasks } from "../llm.js";
import { shortId } from "../constants.js";

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

const DEFAULT_FOCUS_MODES: WorkerType[] = ["navigation", "form", "crud"];

interface PlannerProposal {
  workerType: WorkerType;
  objective: string;
  reason: string;
  /** Optional priority hint (e.g. from LLM). Merged with computed priority via max(). */
  priority?: number;
}

export class Planner {
  private workerTypesPerNode = new Map<string, Set<WorkerType>>();

  /**
   * Propose tasks for a newly discovered state node.
   * Uses the deterministic page-type→worker mapping.
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
    const allowedTypes = mission?.focusModes ?? DEFAULT_FOCUS_MODES;

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

    return this.toFrontierItems(node, proposals);
  }

  /**
   * LLM-assisted task proposal. Calls the planner model to analyze the page
   * and propose targeted test tasks. Falls back to deterministic if the LLM
   * call fails or returns no results.
   */
  async proposeTasksWithLLM(
    node: StateNode,
    graph: StateGraph,
    plannerModel: string,
    mission?: MissionConfig
  ): Promise<FrontierItem[]> {
    const allowedTypes = mission?.focusModes ?? DEFAULT_FOCUS_MODES;

    const nodeDesc = [
      `Page type: ${node.pageType}`,
      node.url ? `URL: ${node.url}` : null,
      node.title ? `Title: ${node.title}` : null,
      `Depth: ${node.depth}`,
      `Controls discovered: ${node.controlsDiscovered.length}`,
      `Controls exercised: ${node.controlsExercised.length}`,
      `Times visited: ${node.timesVisited}`,
      `Risk score: ${node.riskScore}`,
    ]
      .filter(Boolean)
      .join("\n");

    const llmProposals = await proposeLLMTasks(
      plannerModel,
      graph.summary(),
      nodeDesc,
      allowedTypes
    );

    if (!llmProposals) {
      // LLM failed — fall back to deterministic
      return this.proposeTasks(node, graph, mission);
    }

    return this.toFrontierItems(node, llmProposals);
  }

  /**
   * Convert proposal objects to FrontierItems with priority scoring.
   */
  private toFrontierItems(
    node: StateNode,
    proposals: PlannerProposal[]
  ): FrontierItem[] {
    const priorityCtx: PriorityContext = {
      visitedWorkerTypes:
        this.workerTypesPerNode.get(node.id) ?? new Set(),
    };

    return proposals.map((p) => {
      const computed = computePriority(node, p.workerType, priorityCtx);
      return {
        id: `task-${shortId()}`,
        nodeId: node.id,
        workerType: p.workerType,
        objective: p.objective,
        priority: p.priority != null ? Math.max(p.priority, computed) : computed,
        reason: p.reason,
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending" as const,
      };
    });
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
      id: `task-${shortId()}`,
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
