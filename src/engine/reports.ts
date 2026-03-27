import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineContext } from "./context.js";
import type { AreaResult, FrontierItem } from "../types.js";
import { buildRunResult } from "../report/collector.js";
import { renderMarkdown } from "../report/markdown.js";
import { renderJson } from "../report/json.js";
import { writeGeneratedPlaywrightTests } from "../report/test-gen.js";
import { hasLLMApiKey } from "../llm.js";

export function buildAreaResults(ctx: EngineContext): AreaResult[] {
  const results: AreaResult[] = [];
  for (const node of ctx.graph.getAllNodes()) {
    const findings = ctx.findingsByNode.get(node.id) ?? [];
    const evidence = ctx.evidenceByNode.get(node.id) ?? [];
    const replayableActions = ctx.actionsByNode.get(node.id) ?? [];
    if (
      findings.length === 0 &&
      evidence.length === 0 &&
      replayableActions.length === 0 &&
      node.timesVisited === 0
    ) {
      continue;
    }

    results.push({
      name: node.title ?? `${node.pageType} (${node.id})`,
      url: node.url,
      steps: node.timesVisited,
      findings,
      replayableActions,
      screenshots: new Map<string, Buffer>(),
      evidence,
      coverage: {
        controlsDiscovered: node.controlsDiscovered.length,
        controlsExercised: node.controlsExercised.length,
        events: [],
      },
      pageType: node.pageType,
      fingerprint: node.fingerprint,
      status: node.timesVisited > 0 ? "explored" : "skipped",
    });
  }
  return results;
}

export function writeReports(
  ctx: EngineContext,
  startTime: Date,
  areaResults: AreaResult[],
  remaining: FrontierItem[]
): void {
  const config = ctx.config;
  const blindSpots = ctx.globalCoverage.getBlindSpots();
  const stateGraphMermaid = ctx.graph.nodeCount() > 0 ? ctx.graph.toMermaid() : undefined;

  const runResult = buildRunResult(
    config.targetUrl,
    startTime,
    areaResults,
    remaining.map((r) => ({ name: r.objective, reason: `Not reached (priority: ${r.priority.toFixed(2)})` })),
    remaining.length > 0,
    blindSpots,
    stateGraphMermaid,
    {
      appDescription: config.appDescription,
      models: { planner: config.models.planner, worker: config.models.worker },
      concurrency: config.concurrency.workers,
      budget: {
        timeLimitSeconds: ctx.budget.globalTimeLimitSeconds,
        maxStepsPerTask: ctx.budget.maxStepsPerTask,
        maxStateNodes: ctx.budget.maxStateNodes,
      },
      checkpointInterval: config.checkpoint.intervalTasks,
      autoCaptureEnabled: config.autoCapture.consoleErrors || config.autoCapture.networkErrors,
      llmPlannerEnabled: hasLLMApiKey(config.models.planner),
      memoryEnabled: config.memory.enabled,
      visualRegressionEnabled: config.visualRegression.enabled,
      warmStartEnabled: config.memory.enabled && config.memory.warmStart,
    },
    ctx.runMemory
  );
  const generatedTests = writeGeneratedPlaywrightTests(ctx.outputDir, runResult);

  const format = config.output.format;
  if (format === "markdown" || format === "both") {
    const md = renderMarkdown(runResult);
    writeFileSync(join(ctx.outputDir, "report.md"), md, "utf-8");
    console.log(`\nMarkdown report: ${join(ctx.outputDir, "report.md")}`);
  }
  if (format === "json" || format === "both") {
    const json = renderJson(runResult);
    writeFileSync(join(ctx.outputDir, "report.json"), json, "utf-8");
    console.log(`JSON report: ${join(ctx.outputDir, "report.json")}`);
  }
  if (generatedTests.length > 0) {
    console.log(
      `Generated ${generatedTests.length} Playwright test file(s): ${join(ctx.outputDir, "generated-tests")}`
    );
  }
}
