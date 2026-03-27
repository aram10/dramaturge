export type FindingCategory =
  | "Bug"
  | "UX Concern"
  | "Accessibility Issue"
  | "Performance Issue"
  | "Visual Glitch";

export type FindingSeverity = "Critical" | "Major" | "Minor" | "Trivial";

export const CATEGORY_PREFIX: Record<FindingCategory, string> = {
  Bug: "BUG",
  "UX Concern": "UX",
  "Accessibility Issue": "A11Y",
  "Performance Issue": "PERF",
  "Visual Glitch": "VIS",
};

// --- Evidence model ---

export interface Evidence {
  id: string;
  type: "screenshot" | "console-error" | "network-error";
  summary: string;
  path?: string;
  timestamp: string;
  areaName?: string;
  relatedFindingIds: string[];
}

// --- Page classification ---

export type PageType =
  | "landing"
  | "dashboard"
  | "list"
  | "detail"
  | "form"
  | "wizard"
  | "settings"
  | "modal"
  | "auth"
  | "unknown";

// --- Coverage tracking ---

export type ControlAction =
  | "click"
  | "input"
  | "submit"
  | "toggle"
  | "open"
  | "close";

export type ControlOutcome = "worked" | "blocked" | "error" | "unclear";

export interface CoverageEvent {
  controlId: string;
  action: ControlAction;
  outcome: ControlOutcome;
  timestamp: string;
}

export interface CoverageSnapshot {
  controlsDiscovered: number;
  controlsExercised: number;
  events: CoverageEvent[];
}

// --- Findings ---

export interface RawFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  screenshotRef?: string;
  evidenceIds?: string[];
}

export interface Finding extends RawFinding {
  id: string;
  area: string;
  screenshot?: string;
}

// --- Page fingerprint ---

export interface StateSignature {
  pathname: string;
  query: Array<[string, string]>;
  uiMarkers: string[];
}

export interface PageFingerprint {
  normalizedPath: string;
  signature: StateSignature;
  title: string;
  heading: string;
  dialogTitles: string[];
  hash: string;
}

// --- Area and results ---

export interface AreaResult {
  name: string;
  url?: string;
  steps: number;
  findings: RawFinding[];
  screenshots: Map<string, Buffer>;
  evidence: Evidence[];
  coverage: CoverageSnapshot;
  pageType: PageType;
  fingerprint?: PageFingerprint;
  status: "explored" | "failed" | "timeout" | "skipped";
  failureReason?: string;
}

export interface Area {
  name: string;
  url?: string;
  selector?: string;
  description?: string;
}

export interface RunResult {
  targetUrl: string;
  startTime: Date;
  endTime: Date;
  areaResults: AreaResult[];
  unexploredAreas: Array<{ name: string; reason: string }>;
  partial: boolean;
  /** Blind spots from coverage tracker. */
  blindSpots: BlindSpot[];
  /** Mermaid graph source for state graph visualization. */
  stateGraphMermaid?: string;
  /** Run configuration metadata for report context. */
  runConfig?: RunConfigMeta;
}

export interface RunConfigMeta {
  appDescription: string;
  models: { planner: string; worker: string };
  concurrency: number;
  budget: { timeLimitSeconds: number; maxStepsPerTask: number; maxStateNodes: number };
  checkpointInterval: number;
  autoCaptureEnabled: boolean;
  llmPlannerEnabled: boolean;
}

// --- State Graph ---

export interface NavigationHint {
  url?: string;
  selector?: string;
  actionDescription?: string;
}

export interface StateNode {
  id: string;
  url?: string;
  title?: string;
  fingerprint: PageFingerprint;
  pageType: PageType;
  depth: number;
  firstSeenAt: string;
  controlsDiscovered: string[];
  controlsExercised: string[];
  navigationHint?: NavigationHint;
  parentEdgeId?: string;
  tags: string[];
  riskScore: number;
  timesVisited: number;
}

export interface StateEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  actionLabel: string;
  navigationHint: NavigationHint;
  outcome: "success" | "blocked" | "error" | "same-state";
  timestamp: string;
}

// --- Frontier ---

export type WorkerType = "navigation" | "form" | "crud";

export type FrontierItemStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "blocked";

export interface FrontierItem {
  id: string;
  nodeId: string;
  workerType: WorkerType;
  objective: string;
  priority: number;
  reason: string;
  retryCount: number;
  createdAt: string;
  status: FrontierItemStatus;
}

// --- Worker Task / Result ---

export interface WorkerTask {
  id: string;
  workerType: WorkerType;
  nodeId: string;
  objective: string;
  maxSteps: number;
  pageType: PageType;
  missionContext?: string;
}

export interface DiscoveredEdge {
  actionLabel: string;
  navigationHint: NavigationHint;
  targetFingerprint: PageFingerprint;
  targetPageType: PageType;
}

export interface FollowupRequest {
  type: WorkerType;
  reason: string;
  targetNodeId?: string;
  relatedFindingId?: string;
}

export interface WorkerResult {
  taskId: string;
  findings: RawFinding[];
  evidence: Evidence[];
  coverageSnapshot: CoverageSnapshot;
  followupRequests: FollowupRequest[];
  discoveredEdges: DiscoveredEdge[];
  outcome: "completed" | "blocked" | "timed-out" | "failed";
  summary: string;
}

// --- Coverage extension ---

export interface BlindSpot {
  nodeId?: string;
  summary: string;
  reason:
    | "blocked"
    | "time-budget"
    | "pruned"
    | "state-unreachable"
    | "unknown";
  severity: "low" | "medium" | "high";
}

// --- Mission Config ---

export interface MissionConfig {
  appDescription: string;
  criticalFlows?: string[];
  destructiveActionsAllowed: boolean;
  excludedAreas?: string[];
  focusModes?: WorkerType[];
}

// --- Budget Config ---

export interface BudgetConfig {
  globalTimeLimitSeconds: number;
  maxStepsPerTask: number;
  maxFrontierSize: number;
  maxStateNodes: number;
}

// --- Browser Error Capture ---

export interface BrowserConsoleError {
  level: "error" | "warning";
  text: string;
  url: string;
  timestamp: string;
}

export interface BrowserNetworkError {
  method: string;
  url: string;
  status: number;
  statusText: string;
  timestamp: string;
}

export interface BrowserPageError {
  message: string;
  url: string;
  timestamp: string;
}

// --- Checkpoint / Resume ---

export interface Checkpoint {
  version: 1;
  savedAt: string;
  tasksExecuted: number;
  graphSnapshot: {
    nodes: StateNode[];
    edges: StateEdge[];
  };
  frontierSnapshot: FrontierItem[];
  findingsByNode: Record<string, RawFinding[]>;
  evidenceByNode: Record<string, Evidence[]>;
  blindSpots: BlindSpot[];
  completedTaskIds: string[];
}

// --- LLM Planner Task Proposal ---

export interface LLMTaskProposal {
  workerType: WorkerType;
  objective: string;
  reason: string;
  priority: number;
}
