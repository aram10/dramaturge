// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import type { BrowserAgent } from '../browser/agent.js';
import type { DramaturgeConfig } from '../config.js';
import type {
  BudgetConfig,
  MissionConfig,
  RawFinding,
  Evidence,
  ReplayableAction,
} from '../types.js';
import type { StateGraph } from '../graph/state-graph.js';
import type { FrontierQueue } from '../graph/frontier.js';
import type { Planner } from '../planner/planner.js';
import type { Navigator } from '../planner/navigator.js';
import type { CoverageTracker } from '../coverage/tracker.js';
import type { CostTracker } from '../coverage/cost-tracker.js';
import type { BrowserErrorCollector } from '../browser-errors.js';
import type { WorkerSession } from './worker-pool.js';
import type { RepoHints } from '../adaptation/types.js';
import type { MemoryStore } from '../memory/store.js';
import type { CrossRunClassification, RunMemoryMeta } from '../types.js';
import type { NetworkTrafficObserver } from '../network/traffic-observer.js';
import type { ContractIndex } from '../spec/contract-index.js';
import type { ApiRequestContextLike } from '../api/types.js';
import type { SafetyGuard } from '../policy/safety-guard.js';
import type { EngineEventEmitter } from './event-stream.js';
import type { DiffContext } from '../diff/types.js';
import type { Blackboard } from '../a2a/blackboard.js';
import type { MessageBus } from '../a2a/message-bus.js';
import type { Coordinator } from '../a2a/coordinator.js';
import type { EngineLogger } from './logger.js';
import type { ExplorationLedger } from '../types.js';
import type { WorkflowAutomataRuntimeState } from '../workflow-automata/types.js';

export interface EngineContext {
  config: DramaturgeConfig;
  budget: BudgetConfig;
  mission: MissionConfig | undefined;
  /** Browser agent abstraction (currently Stagehand, but can be swapped). Optional during incremental migration. */
  browserAgent?: BrowserAgent;
  /** Legacy Stagehand reference - will be removed once migration is complete. */
  stagehand: Stagehand;
  page: ReturnType<Stagehand['context']['pages']>[number];
  graph: StateGraph;
  frontier: FrontierQueue;
  /** Planner or Coordinator (when A2A is enabled). Coordinator implements a planner-compatible API used here. */
  planner: Planner | Coordinator;
  navigator: Navigator;
  globalCoverage: CoverageTracker;
  costTracker?: CostTracker;
  screenshotDir: string;
  outputDir: string;
  findingsByNode: Map<string, RawFinding[]>;
  evidenceByNode: Map<string, Evidence[]>;
  actionsByNode: Map<string, ReplayableAction[]>;
  runLedger?: ExplorationLedger;
  activeAuthProfile?: string;
  /** Index into CostTracker records marking the start of records not yet appended to runLedger. */
  costLedgerCursor: number;
  errorCollector: BrowserErrorCollector;
  pageNodeOwners: Map<string, string>;
  completedTaskIds: Set<string>;
  workerPool: WorkerSession[];
  repoHints?: RepoHints;
  contractIndex?: ContractIndex;
  diffContext?: DiffContext;
  trafficObserver?: NetworkTrafficObserver;
  memoryStore?: MemoryStore;
  runMemory?: RunMemoryMeta;
  crossRunClassification?: CrossRunClassification;
  createIsolatedApiRequestContext?: () => Promise<ApiRequestContextLike>;
  safetyGuard?: SafetyGuard;
  eventStream?: EngineEventEmitter;
  logger?: EngineLogger;
  /** Multi-agent coordination layer (A2A protocol). */
  blackboard?: Blackboard;
  messageBus?: MessageBus;
  coordinator?: Coordinator;
  workflowAutomata?: WorkflowAutomataRuntimeState;
}
