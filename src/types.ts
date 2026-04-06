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
  type:
    | "screenshot"
    | "console-error"
    | "network-error"
    | "accessibility-scan"
    | "visual-diff"
    | "api-contract"
    | "vision-analysis";
  summary: string;
  path?: string;
  timestamp: string;
  areaName?: string;
  /** Stable raw finding refs collected during runtime; renderers map these to display IDs. */
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

export type FindingSource = "agent" | "auto-capture" | "confirmed";

export type FindingConfidence = "low" | "medium" | "high";

export interface ReproArtifact {
  stateId?: string;
  route?: string;
  objective: string;
  breadcrumbs: string[];
  actionIds?: string[];
  evidenceIds: string[];
}

export interface FindingMeta {
  source: FindingSource;
  confidence: FindingConfidence;
  repro?: ReproArtifact;
}

export interface FindingVerdict {
  hypothesis: string;
  observation: string;
  evidenceChain: string[];
  alternativesConsidered: string[];
  suggestedVerification: string[];
}

export interface RawFinding {
  ref?: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  stepsToReproduce: string[];
  expected: string;
  actual: string;
  screenshotRef?: string;
  evidenceIds?: string[];
  verdict?: FindingVerdict;
  meta?: FindingMeta;
}

export interface FindingOccurrence {
  area: string;
  route?: string;
  evidenceIds: string[];
  ref: string;
}

export interface Finding extends RawFinding {
  id: string;
  area: string;
  screenshot?: string;
  occurrenceCount: number;
  impactedAreas: string[];
  occurrences: FindingOccurrence[];
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
  replayableActions?: ReplayableAction[];
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

export interface DiffSummary {
  baseRef: string;
  changedFileCount: number;
  affectedRoutes: string[];
  affectedRouteFamilies: string[];
  affectedApiEndpoints: string[];
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
  /** Historical-memory summary when run memory is enabled. */
  runMemory?: RunMemoryMeta;
  /** Diff-aware exploration summary, present when diff-aware mode is enabled. */
  diffSummary?: DiffSummary;
}

export interface RunConfigMeta {
  appDescription: string;
  models: { planner: string; worker: string };
  concurrency: number;
  budget: { timeLimitSeconds: number; maxStepsPerTask: number; maxStateNodes: number };
  checkpointInterval: number;
  autoCaptureEnabled: boolean;
  llmPlannerEnabled: boolean;
  memoryEnabled: boolean;
  visualRegressionEnabled: boolean;
  warmStartEnabled: boolean;
}

export interface RunMemoryMeta {
  enabled: boolean;
  warmStartApplied: boolean;
  restoredStateCount: number;
  knownFindingCount: number;
  suppressedFindingCount: number;
  flakyPageCount: number;
  visualBaselineCount: number;
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

export type WorkerType = "navigation" | "form" | "crud" | "api" | "adversarial";

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
  replayableActions?: ReplayableAction[];
  coverageSnapshot: CoverageSnapshot;
  followupRequests: FollowupRequest[];
  discoveredEdges: DiscoveredEdge[];
  outcome: "completed" | "blocked" | "timed-out" | "failed";
  summary: string;
}

export type ReplayableActionKind =
  | "navigate"
  | ControlAction
  | "keydown"
  | "screenshot"
  | "discover-edge";

export type ReplayableActionStatus = ControlOutcome | "recorded";

export interface ReplayableAction {
  id: string;
  kind: ReplayableActionKind;
  summary: string;
  source: "page" | "worker-tool";
  status: ReplayableActionStatus;
  timestamp: string;
  selector?: string;
  url?: string;
  value?: string;
  key?: string;
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
  /**
   * Maximum estimated LLM cost in USD before stopping the run (0 = unlimited).
   *
   * Experimental — cost tracking is approximate and based on published per-token rates.
   * Wire a `CostTracker` from `src/coverage/cost-tracker.ts` into the engine loop to enforce.
   */
  costLimitUsd?: number;
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
  actionsByNode?: Record<string, ReplayableAction[]>;
  blindSpots: BlindSpot[];
  completedTaskIds: string[];
  plannerState?: Record<string, WorkerType[]>;
}

// --- LLM Planner Task Proposal ---

export interface LLMTaskProposal {
  workerType: WorkerType;
  objective: string;
  reason: string;
  priority: number;
}
