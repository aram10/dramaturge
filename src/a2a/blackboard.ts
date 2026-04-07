/**
 * Blackboard — shared state layer for multi-agent coordination.
 *
 * The Blackboard acts as a centralized communication surface where agents
 * post findings, coverage signals, navigation discoveries, and directives.
 * Other agents (notably the Reviewer) observe the board and react.
 *
 * This is the "shared memory" in the blackboard-architecture pattern and
 * aligns with the A2A Artifact sharing model.
 */

import type { BlackboardEntry, BlackboardEntryKind } from "./types.js";
import { shortId } from "../constants.js";

/**
 * A typed blackboard for inter-agent coordination.
 *
 * Agents write entries with a kind + tags combination. Other agents
 * (or the coordinator) subscribe to specific kinds and receive entries
 * as they are posted.
 */
export class Blackboard {
  private entries: BlackboardEntry[] = [];
  private subscribers = new Map<
    BlackboardEntryKind | "*",
    Array<(entry: BlackboardEntry) => void>
  >();

  /** Post an entry to the blackboard. Notifies matching subscribers. */
  post(
    kind: BlackboardEntryKind,
    agentId: string,
    data: Record<string, unknown>,
    tags: string[] = []
  ): BlackboardEntry {
    const entry: BlackboardEntry = {
      id: `bb-${shortId()}`,
      kind,
      agentId,
      data: { ...data },
      timestamp: new Date().toISOString(),
      tags: [...tags],
    };
    this.entries.push(entry);

    // Notify kind-specific subscribers
    const kindSubs = this.subscribers.get(kind);
    if (kindSubs) {
      for (const fn of kindSubs) fn(entry);
    }

    // Notify wildcard subscribers
    const wildcardSubs = this.subscribers.get("*");
    if (wildcardSubs) {
      for (const fn of wildcardSubs) fn(entry);
    }

    return entry;
  }

  /** Subscribe to entries of a specific kind (or "*" for all). */
  subscribe(
    kind: BlackboardEntryKind | "*",
    callback: (entry: BlackboardEntry) => void
  ): () => void {
    const existing = this.subscribers.get(kind) ?? [];
    existing.push(callback);
    this.subscribers.set(kind, existing);

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(kind);
      if (subs) {
        const idx = subs.indexOf(callback);
        if (idx >= 0) subs.splice(idx, 1);
      }
    };
  }

  /** Query entries by kind. */
  query(kind: BlackboardEntryKind): readonly BlackboardEntry[] {
    return this.entries.filter((e) => e.kind === kind);
  }

  /** Query entries by agent. */
  queryByAgent(agentId: string): readonly BlackboardEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  /** Query entries by tag. */
  queryByTag(tag: string): readonly BlackboardEntry[] {
    return this.entries.filter((e) => e.tags.includes(tag));
  }

  /** Get all entries. */
  all(): readonly BlackboardEntry[] {
    return [...this.entries];
  }

  /** Total number of entries. */
  size(): number {
    return this.entries.length;
  }

  /** Produce a compact text summary for LLM context windows. */
  summarize(maxEntries = 20): string {
    const recent = this.entries.slice(-maxEntries);
    if (recent.length === 0) return "No entries on the blackboard yet.";

    const lines = recent.map((e) => {
      const dataPreview =
        typeof e.data.title === "string"
          ? e.data.title
          : typeof e.data.summary === "string"
            ? e.data.summary
            : JSON.stringify(e.data).slice(0, 80);
      return `[${e.kind}] (${e.agentId}) ${dataPreview}`;
    });

    return `Blackboard (${this.entries.length} entries, showing last ${recent.length}):\n${lines.join("\n")}`;
  }
}
