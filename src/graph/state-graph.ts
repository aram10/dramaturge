// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type {
  StateNode,
  StateEdge,
  PageFingerprint,
  PageType,
  NavigationHint,
  DiscoveredEdge,
} from '../types.js';
import { shortId, TRUNCATE_MERMAID_LABEL } from '../constants.js';

export interface AddNodeInit {
  url?: string;
  title?: string;
  fingerprint: PageFingerprint;
  pageType: PageType;
  depth: number;
  navigationHint?: NavigationHint;
  parentEdgeId?: string;
  riskScore?: number;
}

export class StateGraph {
  private nodes = new Map<string, StateNode>();
  private edges = new Map<string, StateEdge>();
  private fingerprintIndex = new Map<string, string>();

  addNode(init: AddNodeInit): StateNode {
    const id = `node-${shortId()}`;
    const node: StateNode = {
      id,
      url: init.url,
      title: init.title,
      fingerprint: init.fingerprint,
      pageType: init.pageType,
      depth: init.depth,
      firstSeenAt: new Date().toISOString(),
      controlsDiscovered: [],
      controlsExercised: [],
      navigationHint: init.navigationHint,
      parentEdgeId: init.parentEdgeId,
      tags: [],
      riskScore: init.riskScore ?? 0,
      timesVisited: 0,
    };
    this.nodes.set(id, node);
    this.fingerprintIndex.set(init.fingerprint.hash, id);
    return node;
  }

  getNode(id: string): StateNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`StateNode not found: ${id}`);
    return node;
  }

  findByFingerprint(fp: PageFingerprint): StateNode | undefined {
    const nodeId = this.fingerprintIndex.get(fp.hash);
    return nodeId ? this.nodes.get(nodeId) : undefined;
  }

  addEdge(fromId: string, toId: string, edge: DiscoveredEdge): StateEdge {
    const id = `edge-${shortId()}`;
    const stateEdge: StateEdge = {
      id,
      fromNodeId: fromId,
      toNodeId: toId,
      actionLabel: edge.actionLabel,
      navigationHint: edge.navigationHint,
      outcome: 'success',
      timestamp: new Date().toISOString(),
    };
    this.edges.set(id, stateEdge);
    return stateEdge;
  }

  /**
   * BFS shortest path from the root node (depth=0) to the target node.
   * Returns ordered list of edges to traverse.
   */
  pathToNode(targetId: string): StateEdge[] {
    const rootNode = this.findRoot();
    if (!rootNode || rootNode.id === targetId) return [];

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: StateEdge[] }> = [{ nodeId: rootNode.id, path: [] }];
    visited.add(rootNode.id);

    // Build adjacency: fromNodeId → edges
    const adjacency = new Map<string, StateEdge[]>();
    for (const edge of this.edges.values()) {
      const list = adjacency.get(edge.fromNodeId) ?? [];
      list.push(edge);
      adjacency.set(edge.fromNodeId, list);
    }

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      const outEdges = adjacency.get(nodeId) ?? [];

      for (const edge of outEdges) {
        if (visited.has(edge.toNodeId)) continue;
        const newPath = [...path, edge];
        if (edge.toNodeId === targetId) return newPath;
        visited.add(edge.toNodeId);
        queue.push({ nodeId: edge.toNodeId, path: newPath });
      }
    }

    return []; // no path found
  }

  /** Increment the visit counter for a node. */
  recordVisit(nodeId: string): void {
    const node = this.getNode(nodeId);
    node.timesVisited++;
  }

  /** Add a control ID to the node's discovered list (deduped). */
  addDiscoveredControl(nodeId: string, controlId: string): void {
    this.addControl(nodeId, 'controlsDiscovered', controlId);
  }

  /** Add a control ID to the node's exercised list (deduped). */
  addExercisedControl(nodeId: string, controlId: string): void {
    this.addControl(nodeId, 'controlsExercised', controlId);
  }

  private addControl(
    nodeId: string,
    key: 'controlsDiscovered' | 'controlsExercised',
    controlId: string
  ): void {
    const node = this.getNode(nodeId);
    if (!node[key].includes(controlId)) {
      node[key].push(controlId);
    }
  }

  /** Restore a node from a checkpoint (used during resume). */
  restoreNode(node: StateNode): void {
    this.nodes.set(node.id, node);
    this.fingerprintIndex.set(node.fingerprint.hash, node.id);
  }

  /** Restore an edge from a checkpoint (used during resume). */
  restoreEdge(edge: StateEdge): void {
    this.edges.set(edge.id, edge);
  }

  getAllNodes(): StateNode[] {
    return [...this.nodes.values()];
  }

  getAllEdges(): StateEdge[] {
    return [...this.edges.values()];
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Human-readable summary for LLM context in proposeTasks.
   */
  summary(): string {
    const nodes = this.getAllNodes();
    const edges = this.getAllEdges();
    const lines = [`State graph: ${nodes.length} nodes, ${edges.length} edges`];
    for (const n of nodes) {
      const exercised = n.controlsExercised.length;
      const discovered = n.controlsDiscovered.length;
      const coverage = discovered > 0 ? `${exercised}/${discovered} controls` : 'no controls';
      lines.push(
        `  [${n.id}] ${n.pageType} depth=${n.depth} visits=${n.timesVisited} ${coverage}${n.url ? ` url=${n.url}` : ''}`
      );
    }
    return lines.join('\n');
  }

  /**
   * Render the state graph as a Mermaid flowchart diagram.
   */
  toMermaid(): string {
    const lines: string[] = ['graph TD'];
    for (const n of this.nodes.values()) {
      const label = this.mermaidEscape(`${n.pageType}${n.title ? `: ${n.title}` : ''}`);
      lines.push(`  ${n.id}["${label}"]`);
    }
    for (const e of this.edges.values()) {
      const label = this.mermaidEscape(e.actionLabel);
      lines.push(`  ${e.fromNodeId} -->|"${label}"| ${e.toNodeId}`);
    }
    return lines.join('\n');
  }

  private mermaidEscape(text: string): string {
    return text.slice(0, TRUNCATE_MERMAID_LABEL).replace(/"/g, '#quot;').replace(/\n/g, ' ');
  }

  private findRoot(): StateNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.depth === 0) return node;
    }
    return undefined;
  }
}
