import type { FrontierItem } from "../types.js";

export class FrontierQueue {
  private items: FrontierItem[] = [];

  enqueue(item: FrontierItem): void {
    this.items.push(item);
  }

  enqueueMany(items: FrontierItem[]): void {
    this.items.push(...items);
  }

  /**
   * Remove and return the highest-priority pending item.
   */
  dequeueHighest(): FrontierItem | undefined {
    const pending = this.items.filter((i) => i.status === "pending");
    if (pending.length === 0) return undefined;
    pending.sort((a, b) => b.priority - a.priority);
    const chosen = pending[0];
    chosen.status = "in-progress";
    return chosen;
  }

  /**
   * Re-queue a blocked/failed item with reduced priority.
   */
  requeue(item: FrontierItem): void {
    item.status = "pending";
    item.priority *= 0.8;
  }

  hasItems(): boolean {
    return this.items.some((i) => i.status === "pending");
  }

  size(): number {
    return this.items.filter((i) => i.status === "pending").length;
  }

  /**
   * Remove the lowest-priority fraction of pending items.
   * Returns removed items for blind spot recording.
   */
  pruneLowest(fraction: number): FrontierItem[] {
    const pending = this.items.filter((i) => i.status === "pending");
    pending.sort((a, b) => a.priority - b.priority);
    const cutCount = Math.ceil(pending.length * fraction);
    const toPrune = pending.slice(0, cutCount);
    const pruneIds = new Set(toPrune.map((i) => i.id));
    this.items = this.items.filter((i) => !pruneIds.has(i.id));
    return toPrune;
  }

  /**
   * Drain all remaining pending items (for end-of-run blind spot recording).
   */
  drain(): FrontierItem[] {
    const remaining = this.items.filter((i) => i.status === "pending");
    for (const item of remaining) {
      item.status = "completed";
    }
    return remaining;
  }
}
