import type { Stagehand } from "@browserbasehq/stagehand";
import type { StateNode, StateEdge } from "../types.js";
import type { StateGraph } from "../graph/state-graph.js";
import { captureFingerprint } from "../graph/fingerprint.js";
import { waitForPageStable } from "../worker/page-stability.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface NavigationResult {
  success: boolean;
  reason?: string;
}

export class Navigator {
  async navigateTo(
    nodeId: string,
    graph: StateGraph,
    page: StagehandPage,
    stagehand: Stagehand,
    rootUrl: string
  ): Promise<NavigationResult> {
    const node = graph.getNode(nodeId);

    // Fast path: direct URL
    if (node.url) {
      await page.goto(node.url);
      await waitForPageStable(page);
      return this.verifyArrival(node, page);
    }

    // Slow path: walk the graph from root
    const path = graph.pathToNode(nodeId);
    if (path.length === 0 && node.depth > 0) {
      return {
        success: false,
        reason: "No path from root to target node",
      };
    }

    // Start from the root URL
    await page.goto(rootUrl);
    await waitForPageStable(page);

    for (const edge of path) {
      const hint = edge.navigationHint;
      try {
        if (hint.url) {
          await page.goto(hint.url);
        } else if (hint.selector) {
          // Stagehand page.click takes (x,y), so use act() for selector-based nav
          await stagehand.act(`Click the element matching "${hint.selector}"`);
        } else if (hint.actionDescription) {
          await stagehand.act(hint.actionDescription);
        }
        await waitForPageStable(page);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          success: false,
          reason: `Navigation step failed: ${message}`,
        };
      }
    }

    return this.verifyArrival(node, page);
  }

  private async verifyArrival(
    node: StateNode,
    page: StagehandPage
  ): Promise<NavigationResult> {
    try {
      const currentFp = await captureFingerprint(page);
      if (currentFp.hash === node.fingerprint.hash) {
        return { success: true };
      }
      // Soft match: same normalized path is "close enough" for dynamic pages
      // where content changes between visits (timestamps, notifications, etc.)
      if (currentFp.normalizedPath === node.fingerprint.normalizedPath) {
        return { success: true };
      }
      return {
        success: false,
        reason: `Fingerprint mismatch: expected ${node.fingerprint.hash} (${node.fingerprint.normalizedPath}), got ${currentFp.hash} (${currentFp.normalizedPath})`,
      };
    } catch {
      // If fingerprinting fails, assume arrival is OK (best-effort)
      return { success: true };
    }
  }
}
