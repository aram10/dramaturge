import { describe, it, expect } from "vitest";
import { FrontierQueue } from "./frontier.js";
import type { FrontierItem } from "../types.js";

function makeItem(
  overrides: Partial<FrontierItem> = {}
): FrontierItem {
  return {
    id: `task-${Math.random().toString(36).slice(2, 6)}`,
    nodeId: "node-test",
    workerType: "navigation",
    objective: "Test objective",
    priority: 0.5,
    reason: "test",
    retryCount: 0,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...overrides,
  };
}

describe("FrontierQueue", () => {
  describe("enqueue / hasItems / size", () => {
    it("starts empty", () => {
      const q = new FrontierQueue();
      expect(q.hasItems()).toBe(false);
      expect(q.size()).toBe(0);
    });

    it("tracks enqueued items", () => {
      const q = new FrontierQueue();
      q.enqueue(makeItem());
      expect(q.hasItems()).toBe(true);
      expect(q.size()).toBe(1);
    });

    it("enqueues many items", () => {
      const q = new FrontierQueue();
      q.enqueueMany([makeItem(), makeItem(), makeItem()]);
      expect(q.size()).toBe(3);
    });
  });

  describe("dequeueHighest", () => {
    it("returns undefined when empty", () => {
      const q = new FrontierQueue();
      expect(q.dequeueHighest()).toBeUndefined();
    });

    it("returns the highest priority item", () => {
      const q = new FrontierQueue();
      const low = makeItem({ id: "low", priority: 0.1 });
      const high = makeItem({ id: "high", priority: 0.9 });
      const mid = makeItem({ id: "mid", priority: 0.5 });
      q.enqueueMany([low, high, mid]);

      const result = q.dequeueHighest();
      expect(result?.id).toBe("high");
      expect(result?.status).toBe("in-progress");
    });

    it("skips non-pending items", () => {
      const q = new FrontierQueue();
      const completed = makeItem({
        id: "done",
        priority: 1.0,
        status: "completed",
      });
      const pending = makeItem({ id: "pending", priority: 0.5 });
      q.enqueueMany([completed, pending]);

      const result = q.dequeueHighest();
      expect(result?.id).toBe("pending");
    });

    it("returns undefined when all items are non-pending", () => {
      const q = new FrontierQueue();
      q.enqueue(makeItem({ status: "completed" }));
      q.enqueue(makeItem({ status: "in-progress" }));
      expect(q.dequeueHighest()).toBeUndefined();
    });
  });

  describe("requeue", () => {
    it("resets status to pending with reduced priority", () => {
      const q = new FrontierQueue();
      const item = makeItem({ priority: 1.0 });
      q.enqueue(item);

      const dequeued = q.dequeueHighest()!;
      expect(dequeued.status).toBe("in-progress");

      q.requeue(dequeued);
      expect(dequeued.status).toBe("pending");
      expect(dequeued.priority).toBeCloseTo(0.8);
    });
  });

  describe("pruneLowest", () => {
    it("removes the lowest-priority fraction", () => {
      const q = new FrontierQueue();
      q.enqueueMany([
        makeItem({ id: "a", priority: 0.1 }),
        makeItem({ id: "b", priority: 0.2 }),
        makeItem({ id: "c", priority: 0.5 }),
        makeItem({ id: "d", priority: 0.9 }),
      ]);

      const pruned = q.pruneLowest(0.5);
      // Should prune 2 lowest: a(0.1) and b(0.2)
      expect(pruned).toHaveLength(2);
      expect(pruned.map((p) => p.id).sort()).toEqual(["a", "b"]);
      expect(q.size()).toBe(2);
    });

    it("returns empty array when nothing to prune", () => {
      const q = new FrontierQueue();
      expect(q.pruneLowest(0.5)).toEqual([]);
    });
  });

  describe("drain", () => {
    it("returns all pending items and marks them completed", () => {
      const q = new FrontierQueue();
      q.enqueueMany([
        makeItem({ id: "a" }),
        makeItem({ id: "b" }),
      ]);
      // Take one out
      q.dequeueHighest();

      const drained = q.drain();
      // Only the remaining pending item should be drained
      expect(drained).toHaveLength(1);
      expect(drained[0].status).toBe("completed");
      expect(q.hasItems()).toBe(false);
    });
  });
});
