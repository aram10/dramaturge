import type { FrontierItem } from '../types.js';
import { REQUEUE_PRIORITY_DECAY } from '../constants.js';

export class FrontierQueue {
  /** Sorted descending by priority — highest-priority items first. */
  private items: FrontierItem[] = [];

  enqueue(item: FrontierItem): void {
    this.insertSorted(item);
  }

  enqueueMany(items: FrontierItem[]): void {
    for (const item of items) {
      this.insertSorted(item);
    }
  }

  /**
   * Remove and return the highest-priority pending item. O(n) scan from front.
   */
  dequeueHighest(): FrontierItem | undefined {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].status === 'pending') {
        this.items[i].status = 'in-progress';
        return this.items[i];
      }
    }
    return undefined;
  }

  /**
   * Re-queue a blocked/failed item with reduced priority.
   */
  requeue(item: FrontierItem): void {
    // Remove from current position
    const idx = this.items.indexOf(item);
    if (idx !== -1) this.items.splice(idx, 1);

    item.status = 'pending';
    item.priority *= REQUEUE_PRIORITY_DECAY;

    // Re-insert at correct sorted position
    this.insertSorted(item);
  }

  hasItems(): boolean {
    return this.items.some((i) => i.status === 'pending');
  }

  size(): number {
    return this.items.filter((i) => i.status === 'pending').length;
  }

  /**
   * Remove the lowest-priority fraction of pending items.
   * Returns removed items for blind spot recording.
   */
  pruneLowest(fraction: number): FrontierItem[] {
    const pending = this.items.filter((i) => i.status === 'pending');
    // Items are sorted descending, so lowest are at the end of pending
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
    const remaining = this.items.filter((i) => i.status === 'pending');
    for (const item of remaining) {
      item.status = 'completed';
    }
    return remaining;
  }

  /**
   * Return a shallow copy of all items (for checkpoint serialization).
   */
  snapshot(): FrontierItem[] {
    return this.items.map((i) => ({ ...i }));
  }

  /** Binary search insert to maintain descending sort order by priority. */
  private insertSorted(item: FrontierItem): void {
    let lo = 0;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.items[mid].priority > item.priority) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.items.splice(lo, 0, item);
  }
}
