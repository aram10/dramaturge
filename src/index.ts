// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

// Public API surface for the `dramaturge` package.
//
// This barrel is intentionally curated: it exposes the stable runtime engine,
// configuration, LLM provider helpers, engine events, core domain types, and a
// handful of standalone quality utilities (visual/web-vitals/cost). Deep
// internal building blocks — repo/framework scanners, OpenAPI/spec plumbing,
// diff parsing, API replay internals, the terminal dashboard, the MCP server,
// the evals harness, and the speculative a2a / workflow-automata subsystems —
// are deliberately NOT re-exported here to keep the published compatibility
// surface small. They remain available to the CLI and internal code via their
// own modules; promote one back into this barrel only when there is a concrete
// external consumer for it.

// --- Configuration ---
export {
  ConfigSchema,
  loadConfig,
  resolveAgentMode,
  resolveWorkerModel,
  resolveOutputFormats,
} from './config.js';
export type {
  ApiTestingConfig,
  AdversarialConfig,
  FormAuthField,
  FormAuthSubmit,
  JudgeConfig,
  OAuthRedirectStep,
  DramaturgeConfig,
  LoadedDramaturgeConfig,
  WorkflowAutomataConfig,
} from './config.js';
export { PRESET_NAMES } from './presets.js';
export type { PresetName } from './presets.js';

// --- LLM providers ---
export {
  resolveProvider,
  stripProviderPrefix,
  hasConfiguredProvider,
  detectProviderFromEnv,
  allProviders,
  sendChatCompletion,
  sendVisionCompletion,
  createOpenAICompatibleProvider,
} from './llm/index.js';
export type { ChatMessage, ProviderId, LLMProviderAdapter, ProviderRequest } from './llm/index.js';

// --- Stable runtime API ---
export { runEngine } from './engine.js';
export type { RunEngineOptions } from './engine.js';
export { EngineEventEmitter, emitEngineEvent } from './engine/event-stream.js';
export type {
  EngineEventMap,
  EngineEventName,
  LogEvent,
  LogLevel,
  RunStartEvent,
  RunEndEvent,
  TaskStartEvent,
  TaskCompleteEvent,
  FindingEvent,
  StateDiscoveredEvent,
  ProgressEvent,
  CheckpointEvent,
  ErrorEvent,
} from './engine/event-stream.js';
export { CATEGORY_PREFIX } from './types.js';

// --- Cross-run memory ---
export { MemoryStore, buildFindingSignature } from './memory/store.js';

// --- Standalone quality utilities ---
export { comparePngBuffers, runVisualRegressionScan } from './coverage/visual-regression.js';
export { collectWebVitals, evaluateWebVitals } from './coverage/web-vitals.js';
export type { WebVitalsResult, WebVitalsThresholds } from './coverage/web-vitals.js';
export {
  runMultiViewportVisualRegression,
  DEFAULT_BREAKPOINTS,
} from './coverage/responsive-regression.js';
export type {
  ResponsiveBreakpoint,
  MultiViewportOptions,
} from './coverage/responsive-regression.js';
export { CostTracker, estimateCallCost, approximateTokenCount } from './coverage/cost-tracker.js';
export type { CostRecord, CostSummary } from './coverage/cost-tracker.js';

// --- Core domain types ---
export type {
  Area,
  AreaResult,
  BlindSpot,
  BrowserConsoleError,
  BrowserNetworkError,
  BrowserPageError,
  ControlAction,
  ControlOutcome,
  ConfirmationResult,
  CoverageEvent,
  CoverageSnapshot,
  DiffSummary,
  DiscoveredEdge,
  Evidence,
  ExplorationLedger,
  ExplorationLedgerEvent,
  ExplorationLedgerActionEvent,
  ExplorationLedgerEvidenceEvent,
  ExplorationLedgerNetworkEvent,
  ExplorationLedgerFindingEvent,
  ExplorationLedgerModelUsageEvent,
  Finding,
  FindingCategory,
  FindingConfidence,
  FindingMeta,
  FindingOccurrence,
  FindingSeverity,
  FindingSource,
  FindingVerdict,
  FrontierItem,
  FrontierItemStatus,
  LLMTaskProposal,
  MissionConfig,
  NavigationHint,
  PageFingerprint,
  PageType,
  RawFinding,
  ReplayableAction,
  ReplayableActionKind,
  ReplayableActionStatus,
  ReproArtifact,
  RunConfigMeta,
  RunMemoryMeta,
  RunResult,
  SafetyAuditSummary,
  StateEdge,
  StateNode,
  StateSignature,
  WorkerResult,
  WorkerTask,
  WorkerType,
} from './types.js';
