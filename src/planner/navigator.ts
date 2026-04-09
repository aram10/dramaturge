// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { Stagehand } from '@browserbasehq/stagehand';
import type { NavigationHint, StateNode } from '../types.js';
import type { StateGraph } from '../graph/state-graph.js';
import { captureFingerprint } from '../graph/fingerprint.js';
import { hasPathOnlyStateSignature, signaturesEqual } from '../graph/state-signature.js';
import { waitForPageStable } from '../worker/page-stability.js';

type StagehandPage = ReturnType<Stagehand['context']['pages']>[number];

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
      await page.goto(this.resolveUrl(node.url, rootUrl));
      await waitForPageStable(page);
      return this.verifyArrival(node, page);
    }

    // Slow path: walk the graph from root
    const path = graph.pathToNode(nodeId);
    if (path.length === 0 && node.depth > 0) {
      return {
        success: false,
        reason: 'No path from root to target node',
      };
    }

    // Start from the root URL
    await page.goto(rootUrl);
    await waitForPageStable(page);

    for (const edge of path) {
      try {
        await this.followHint(edge.navigationHint, page, stagehand, rootUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          reason: `Navigation step failed: ${message}`,
        };
      }
    }

    return this.verifyArrival(node, page);
  }

  async navigateFromNode(
    fromNodeId: string,
    hint: NavigationHint,
    graph: StateGraph,
    page: StagehandPage,
    stagehand: Stagehand,
    rootUrl: string
  ): Promise<NavigationResult> {
    const restored = await this.navigateTo(fromNodeId, graph, page, stagehand, rootUrl);
    if (!restored.success) {
      return restored;
    }

    try {
      await this.followHint(hint, page, stagehand, rootUrl);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        reason: `Navigation step failed: ${message}`,
      };
    }
  }

  private async verifyArrival(node: StateNode, page: StagehandPage): Promise<NavigationResult> {
    try {
      const currentFp = await captureFingerprint(page);
      if (currentFp.hash === node.fingerprint.hash) {
        return { success: true };
      }
      if (signaturesEqual(currentFp.signature, node.fingerprint.signature)) {
        return { success: true };
      }
      // Soft match only when both pages are path-only states. This keeps
      // dynamic pages tolerant without collapsing meaningful query/UI states.
      if (
        currentFp.normalizedPath === node.fingerprint.normalizedPath &&
        hasPathOnlyStateSignature(currentFp.signature) &&
        hasPathOnlyStateSignature(node.fingerprint.signature)
      ) {
        return { success: true };
      }
      return {
        success: false,
        reason: `Fingerprint mismatch: expected ${node.fingerprint.hash} (${node.fingerprint.normalizedPath}), got ${currentFp.hash} (${currentFp.normalizedPath})`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        reason: `Navigation verification failed: ${message}`,
      };
    }
  }

  private async followHint(
    hint: NavigationHint,
    page: StagehandPage,
    stagehand: Stagehand,
    rootUrl: string
  ): Promise<void> {
    if (hint.url) {
      await page.goto(this.resolveUrl(hint.url, rootUrl));
    } else if (hint.selector) {
      await stagehand.act(`Click the element matching "${hint.selector}"`);
    } else if (hint.actionDescription) {
      await stagehand.act(hint.actionDescription);
    } else {
      throw new Error('No navigation hint available');
    }
    await waitForPageStable(page);
  }

  private resolveUrl(url: string, rootUrl: string): string {
    return new URL(url, rootUrl).href;
  }
}
