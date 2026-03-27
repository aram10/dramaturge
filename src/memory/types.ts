import type {
  FindingCategory,
  FindingConfidence,
  FindingSeverity,
  PageFingerprint,
  PageType,
  StateEdge,
  StateNode,
} from "../types.js";
import type { ObservedApiEndpoint } from "../network/traffic-observer.js";

export interface HistoricalFindingRecord {
  signature: string;
  title: string;
  category: FindingCategory;
  severity: FindingSeverity;
  confidence?: FindingConfidence;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  occurrenceCount: number;
  recentRoutes: string[];
  dismissedAt?: string;
  dismissalReason?: string;
  suppressed?: boolean;
}

export interface HistoricalFlakyPageRecord {
  key: string;
  route?: string;
  fingerprintHash?: string;
  note: string;
  source: "visual-regression" | "manual";
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
}

export interface HistoricalAuthHints {
  successfulLoginRoutes: string[];
}

export interface HistoricalApiEndpointRecord extends ObservedApiEndpoint {
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
}

export interface NavigationMemorySnapshot {
  targetOrigin: string;
  savedAt: string;
  nodes: StateNode[];
  edges: StateEdge[];
}

export interface MemorySnapshot {
  version: 1;
  updatedAt: string;
  findingHistory: Record<string, HistoricalFindingRecord>;
  flakyPages: HistoricalFlakyPageRecord[];
  authHints: HistoricalAuthHints;
  observedApiCatalog: HistoricalApiEndpointRecord[];
  navigation?: NavigationMemorySnapshot;
}

export interface WorkerHistoryContext {
  suppressedFindings: string[];
  flakyPageNotes: string[];
  navigationHints: string[];
  authHints: string[];
  apiHints: ObservedApiEndpoint[];
}

export interface PlannerMemorySignals {
  hasSuppressedFindings: boolean;
  hasFlakyPageNotes: boolean;
  hasNavigationHints: boolean;
}

export interface MemoryRouteMatchInput {
  url?: string;
  fingerprint?: PageFingerprint;
  pageType?: PageType;
}

export interface FlakyPageInput {
  route?: string;
  fingerprintHash?: string;
  note: string;
  source?: HistoricalFlakyPageRecord["source"];
}
