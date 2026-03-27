import type { EngineContext } from "./context.js";
import type { WorkerResult, FrontierItem } from "../types.js";
import { captureFingerprint } from "../graph/fingerprint.js";
import { classifyPage } from "../planner/page-classifier.js";

function appendToNodeMap<T>(map: Map<string, T[]>, nodeId: string, items: T[]): void {
  const existing = map.get(nodeId) ?? [];
  existing.push(...items);
  map.set(nodeId, existing);
}

export function collectResults(ctx: EngineContext, nodeId: string, result: WorkerResult): void {
  appendToNodeMap(ctx.findingsByNode, nodeId, result.findings);
  appendToNodeMap(ctx.evidenceByNode, nodeId, result.evidence);
  appendToNodeMap(ctx.actionsByNode, nodeId, result.replayableActions ?? []);

  for (const event of result.coverageSnapshot.events) {
    ctx.globalCoverage.recordEvent(event);
    ctx.graph.addDiscoveredControl(nodeId, event.controlId);
    if (event.outcome === "worked") {
      ctx.graph.addExercisedControl(nodeId, event.controlId);
    }
  }
}

export async function expandGraph(
  ctx: EngineContext,
  sourceNodeId: string,
  result: WorkerResult,
  useLLMPlanner = false
): Promise<void> {
  if (ctx.graph.nodeCount() >= ctx.budget.maxStateNodes) return;
  const sourceNode = ctx.graph.getNode(sourceNodeId);

  for (const edge of result.discoveredEdges) {
    if (ctx.graph.nodeCount() >= ctx.budget.maxStateNodes) break;

    let fingerprint = edge.targetFingerprint;
    let pageType = edge.targetPageType;

    // Workers report discovered edges with an empty fingerprint hash when
    // they haven't navigated to the target page yet. Resolve by navigating.
    if (fingerprint.hash === "") {
      const resolved = await resolveEdgeFingerprint(
        ctx,
        sourceNodeId,
        edge.navigationHint
      );
      if (!resolved) continue;
      fingerprint = resolved.fingerprint;
      pageType = resolved.pageType;
      try { await ctx.page.goto(ctx.config.targetUrl); } catch { /* best-effort */ }
    }

    const existing = ctx.graph.findByFingerprint(fingerprint);
    if (!existing) {
      const newNode = ctx.graph.addNode({
        fingerprint, pageType,
        url: edge.navigationHint.url,
        depth: sourceNode.depth + 1,
        navigationHint: edge.navigationHint,
      });
      ctx.graph.addEdge(sourceNodeId, newNode.id, edge);

      const newTasks = useLLMPlanner
        ? await ctx.planner.proposeTasksWithLLM(
            newNode,
            ctx.graph,
            ctx.config.models.planner,
            ctx.mission,
            ctx.repoHints,
            ctx.config.llm.requestTimeoutMs,
            ctx.memoryStore?.getPlannerSignals(newNode)
          )
        : ctx.planner.proposeTasks(
            newNode,
            ctx.graph,
            ctx.mission,
            ctx.repoHints,
            ctx.memoryStore?.getPlannerSignals(newNode)
          );
      ctx.frontier.enqueueMany(newTasks);
      console.log(`  Discovered new state: ${newNode.pageType} (${newNode.id}), +${newTasks.length} tasks`);
    }
  }
}

async function resolveEdgeFingerprint(
  ctx: EngineContext,
  sourceNodeId: string,
  hint: { url?: string; selector?: string; actionDescription?: string }
): Promise<{ fingerprint: Awaited<ReturnType<typeof captureFingerprint>>; pageType: Awaited<ReturnType<typeof classifyPage>> } | null> {
  try {
    const navigation = await ctx.navigator.navigateFromNode(
      sourceNodeId,
      hint,
      ctx.graph,
      ctx.page,
      ctx.stagehand,
      ctx.config.targetUrl
    );
    if (!navigation.success) {
      console.log(
        `  Could not resolve discovered edge: ${navigation.reason ?? "navigation failed"}`
      );
      return null;
    }

    return {
      fingerprint: await captureFingerprint(ctx.page),
      pageType: await classifyPage(ctx.page),
    };
  } catch (error) {
    console.log(`  Could not resolve discovered edge: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function routeFollowups(ctx: EngineContext, sourceNodeId: string, result: WorkerResult): void {
  for (const followup of result.followupRequests) {
    ctx.frontier.enqueue(ctx.planner.routeFollowup(followup, sourceNodeId));
  }
}

export function maintainFrontier(ctx: EngineContext): void {
  if (ctx.frontier.size() > ctx.budget.maxFrontierSize) {
    const pruned = ctx.frontier.pruneLowest(0.25);
    for (const p of pruned) {
      ctx.globalCoverage.addBlindSpot({
        nodeId: p.nodeId,
        summary: `Pruned: ${p.objective}`,
        reason: "pruned",
        severity: "low",
      });
    }
    console.log(`  Pruned ${pruned.length} low-priority frontier items`);
  }
}

export function flushBrowserErrors(
  ctx: EngineContext,
  nodeId: string,
  pageKey: string
): void {
  if (ctx.errorCollector.pendingCount(pageKey) === 0) return;
  const { findings, evidence } = ctx.errorCollector.flush(pageKey);
  if (findings.length === 0) return;

  appendToNodeMap(ctx.findingsByNode, nodeId, findings);
  appendToNodeMap(ctx.evidenceByNode, nodeId, evidence);

  console.log(`  Auto-captured ${findings.length} browser error(s)`);
}
