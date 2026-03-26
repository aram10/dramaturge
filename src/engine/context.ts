import type { Stagehand } from "@browserbasehq/stagehand";
import type { WebProbeConfig } from "../config.js";
import type { BudgetConfig, MissionConfig, RawFinding, Evidence } from "../types.js";
import type { StateGraph } from "../graph/state-graph.js";
import type { FrontierQueue } from "../graph/frontier.js";
import type { Planner } from "../planner/planner.js";
import type { Navigator } from "../planner/navigator.js";
import type { CoverageTracker } from "../coverage/tracker.js";
import type { BrowserErrorCollector } from "../browser-errors.js";

export interface EngineContext {
  config: WebProbeConfig;
  budget: BudgetConfig;
  mission: MissionConfig | undefined;
  stagehand: Stagehand;
  page: ReturnType<Stagehand["context"]["pages"]>[number];
  graph: StateGraph;
  frontier: FrontierQueue;
  planner: Planner;
  navigator: Navigator;
  globalCoverage: CoverageTracker;
  screenshotDir: string;
  outputDir: string;
  findingsByNode: Map<string, RawFinding[]>;
  evidenceByNode: Map<string, Evidence[]>;
  errorCollector: BrowserErrorCollector;
  completedTaskIds: Set<string>;
  workerPool: Stagehand[];
}
