import type {
  StateNode,
  FrontierItem,
  FollowupRequest,
  WorkerType,
  MissionConfig,
  PageType,
} from "../types.js";
import type { RepoHints } from "../adaptation/types.js";
import type { StateGraph } from "../graph/state-graph.js";
import { computePriority, type PriorityContext } from "./priority.js";
import { proposeLLMTasks } from "../llm.js";
import { shortId } from "../constants.js";
import type { PlannerMemorySignals } from "../memory/types.js";

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

function matchesMissionPattern(
  patterns: string[] | undefined,
  ...candidates: Array<string | undefined>
): boolean {
  if (!patterns?.length) return false;

  const haystacks = candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => candidate.toLowerCase());

  return patterns.some((pattern) => {
    const needle = pattern.toLowerCase();
    return haystacks.some((candidate) => candidate.includes(needle));
  });
}

function summarizeRepoHints(repoHints?: RepoHints): string | undefined {
  if (!repoHints) return undefined;

  const parts: string[] = [];
  if (repoHints.routes.length > 0) {
    parts.push(`routes: ${repoHints.routes.slice(0, 3).join(", ")}`);
  }
  if ((repoHints.routeFamilies?.length ?? 0) > 0) {
    parts.push(`route families: ${repoHints.routeFamilies.slice(0, 3).join(", ")}`);
  }
  if (repoHints.stableSelectors.length > 0) {
    parts.push(
      `stable selectors: ${repoHints.stableSelectors.slice(0, 3).join(", ")}`
    );
  }
  if ((repoHints.apiEndpoints?.length ?? 0) > 0) {
    parts.push(
      `api endpoints: ${repoHints.apiEndpoints
        .slice(0, 2)
        .map((endpoint) => `${endpoint.methods.join("/") || "ANY"} ${endpoint.route}`)
        .join(", ")}`
    );
  }
  if (repoHints.authHints.loginRoutes.length > 0) {
    parts.push(
      `login routes: ${repoHints.authHints.loginRoutes.slice(0, 2).join(", ")}`
    );
  }

  return parts.length > 0 ? parts.join("; ") : undefined;
}

function relevantApiEndpointsForNode(
  node: StateNode,
  repoHints?: RepoHints
): RepoHints["apiEndpoints"] {
  if (!repoHints?.apiEndpoints.length) {
    return [];
  }

  const urlTokens = (node.url ?? "")
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .filter((token) => token !== "api");

  const matches = repoHints.apiEndpoints.filter((endpoint) =>
    urlTokens.some((token) => endpoint.route.toLowerCase().includes(token))
  );

  return matches.length > 0 ? matches : repoHints.apiEndpoints;
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
    mission?: MissionConfig,
    repoHints?: RepoHints,
    memorySignals?: PlannerMemorySignals
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

    const repoHintSummary = summarizeRepoHints(repoHints);
    if (
      repoHintSummary &&
      allowedTypes.includes("navigation") &&
      node.depth === 0 &&
      node.timesVisited === 0
    ) {
      proposals.push({
        workerType: "navigation",
        objective: `Use repo-aware hints to probe likely routes and controls from this page: ${repoHintSummary}`,
        reason: "Repo-aware navigation seed",
        priority: 0.85,
      });
    }

    const apiHints = relevantApiEndpointsForNode(node, repoHints);
    if (allowedTypes.includes("api") && node.timesVisited === 0 && apiHints.length > 0) {
      proposals.push({
        workerType: "api",
        objective: `Probe related API contracts and auth boundaries for ${node.title ?? node.pageType}${node.url ? ` at ${node.url}` : ""}: ${apiHints
          .slice(0, 2)
          .map((endpoint) => `${endpoint.methods.join("/") || "ANY"} ${endpoint.route}`)
          .join(", ")}`,
        reason: "API-aware follow-up for this page",
        priority: 0.78,
      });
    }

    if (
      allowedTypes.includes("adversarial") &&
      node.timesVisited === 0 &&
      ["form", "list", "detail", "settings", "wizard", "modal"].includes(node.pageType)
    ) {
      proposals.push({
        workerType: "adversarial",
        objective: `Probe edge cases, stale-state behavior, and replay/idempotency risks for ${node.title ?? node.pageType}${node.url ? ` at ${node.url}` : ""}`,
        reason: "Low-priority adversarial coverage pass",
        priority: 0.35,
      });
    }

    return this.toFrontierItems(node, proposals, mission, memorySignals);
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
    mission?: MissionConfig,
    repoHints?: RepoHints,
    llmRequestTimeoutMs?: number,
    memorySignals?: PlannerMemorySignals
  ): Promise<FrontierItem[]> {
    const allowedTypes = mission?.focusModes ?? DEFAULT_FOCUS_MODES;
    const repoHintSummary = summarizeRepoHints(repoHints);

    const nodeDesc = [
      `Page type: ${node.pageType}`,
      node.url ? `URL: ${node.url}` : null,
      node.title ? `Title: ${node.title}` : null,
      `Depth: ${node.depth}`,
      `Controls discovered: ${node.controlsDiscovered.length}`,
      `Controls exercised: ${node.controlsExercised.length}`,
      `Times visited: ${node.timesVisited}`,
      `Risk score: ${node.riskScore}`,
      repoHintSummary ? `Repo hints: ${repoHintSummary}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const llmProposals = await proposeLLMTasks(
      plannerModel,
      graph.summary(),
      nodeDesc,
      allowedTypes,
      llmRequestTimeoutMs
    );

    if (!llmProposals) {
      // LLM failed — fall back to deterministic
      return this.proposeTasks(node, graph, mission, repoHints, memorySignals);
    }

    return this.toFrontierItems(node, llmProposals, mission, memorySignals);
  }

  /**
   * Convert proposal objects to FrontierItems with priority scoring.
   */
  private toFrontierItems(
    node: StateNode,
    proposals: PlannerProposal[],
    mission?: MissionConfig,
    memorySignals?: PlannerMemorySignals
  ): FrontierItem[] {
    const priorityCtx: PriorityContext = {
      visitedWorkerTypes:
        this.workerTypesPerNode.get(node.id) ?? new Set(),
      memory: memorySignals,
    };

    return proposals
      .map((p) => {
        const computed = computePriority(node, p.workerType, priorityCtx);
        const criticalFlowBoost = matchesMissionPattern(
          mission?.criticalFlows,
          p.objective,
          p.reason,
          node.url,
          node.title,
          node.pageType
        )
          ? 0.2
          : 0;

        return {
        id: `task-${shortId()}`,
        nodeId: node.id,
        workerType: p.workerType,
        objective: p.objective,
        priority: Math.min(
          1,
          (p.priority != null ? Math.max(p.priority, computed) : computed) +
            criticalFlowBoost
        ),
        reason: p.reason,
        retryCount: 0,
        createdAt: new Date().toISOString(),
        status: "pending" as const,
        };
      })
      .filter((item) =>
        !matchesMissionPattern(
          mission?.excludedAreas,
          item.objective,
          item.reason,
          node.url,
          node.title,
          node.pageType
        )
      );
  }

  /**
   * Record that a worker type has been dispatched for a node.
   */
  recordDispatch(nodeId: string, workerType: WorkerType): void {
    const set = this.workerTypesPerNode.get(nodeId) ?? new Set();
    set.add(workerType);
    this.workerTypesPerNode.set(nodeId, set);
  }

  snapshotDispatchState(): Record<string, WorkerType[]> {
    return Object.fromEntries(
      [...this.workerTypesPerNode.entries()].map(([nodeId, workerTypes]) => [
        nodeId,
        [...workerTypes].sort(),
      ])
    );
  }

  restoreDispatchState(snapshot: Record<string, WorkerType[]>): void {
    this.workerTypesPerNode = new Map(
      Object.entries(snapshot).map(([nodeId, workerTypes]) => [
        nodeId,
        new Set(workerTypes),
      ])
    );
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
