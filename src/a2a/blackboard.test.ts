import { describe, it, expect, vi } from "vitest";
import { Blackboard } from "./blackboard.js";

describe("Blackboard", () => {
  it("starts empty", () => {
    const bb = new Blackboard();
    expect(bb.size()).toBe(0);
    expect(bb.all()).toEqual([]);
  });

  it("posts an entry and increments size", () => {
    const bb = new Blackboard();
    const entry = bb.post("finding", "agent-tester", { title: "Bug found" });
    expect(bb.size()).toBe(1);
    expect(entry.id).toMatch(/^bb-/);
    expect(entry.kind).toBe("finding");
    expect(entry.agentId).toBe("agent-tester");
    expect(entry.data.title).toBe("Bug found");
    expect(entry.timestamp).toBeTruthy();
  });

  it("posts with tags", () => {
    const bb = new Blackboard();
    bb.post("coverage", "agent-scout", { summary: "Mapped 5 pages" }, ["navigation", "done"]);
    const entries = bb.queryByTag("navigation");
    expect(entries).toHaveLength(1);
    expect(entries[0].tags).toContain("navigation");
    expect(entries[0].tags).toContain("done");
  });

  it("queries by kind", () => {
    const bb = new Blackboard();
    bb.post("finding", "agent-tester", { title: "Bug 1" });
    bb.post("coverage", "agent-scout", { summary: "Mapped" });
    bb.post("finding", "agent-security", { title: "Bug 2" });

    const findings = bb.query("finding");
    expect(findings).toHaveLength(2);
    expect(findings.every((e) => e.kind === "finding")).toBe(true);
  });

  it("queries by agent", () => {
    const bb = new Blackboard();
    bb.post("finding", "agent-tester", { title: "Bug 1" });
    bb.post("coverage", "agent-tester", { summary: "Coverage" });
    bb.post("finding", "agent-security", { title: "Bug 2" });

    const testerEntries = bb.queryByAgent("agent-tester");
    expect(testerEntries).toHaveLength(2);
    expect(testerEntries.every((e) => e.agentId === "agent-tester")).toBe(true);
  });

  it("queries by tag", () => {
    const bb = new Blackboard();
    bb.post("finding", "agent-tester", { title: "Bug" }, ["critical"]);
    bb.post("finding", "agent-security", { title: "Vuln" }, ["critical", "security"]);
    bb.post("coverage", "agent-scout", { summary: "Done" }, ["navigation"]);

    expect(bb.queryByTag("critical")).toHaveLength(2);
    expect(bb.queryByTag("security")).toHaveLength(1);
    expect(bb.queryByTag("navigation")).toHaveLength(1);
    expect(bb.queryByTag("nonexistent")).toHaveLength(0);
  });

  it("notifies kind-specific subscribers", () => {
    const bb = new Blackboard();
    const handler = vi.fn();
    bb.subscribe("finding", handler);

    bb.post("finding", "agent-tester", { title: "Bug" });
    bb.post("coverage", "agent-scout", { summary: "Done" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "finding", agentId: "agent-tester" })
    );
  });

  it("notifies wildcard subscribers for all entries", () => {
    const bb = new Blackboard();
    const handler = vi.fn();
    bb.subscribe("*", handler);

    bb.post("finding", "agent-tester", { title: "Bug" });
    bb.post("coverage", "agent-scout", { summary: "Done" });
    bb.post("directive", "coordinator", { text: "Focus on forms" });

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("unsubscribe stops notifications", () => {
    const bb = new Blackboard();
    const handler = vi.fn();
    const unsub = bb.subscribe("finding", handler);

    bb.post("finding", "agent-tester", { title: "Bug 1" });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bb.post("finding", "agent-tester", { title: "Bug 2" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("summarize returns a compact text for empty board", () => {
    const bb = new Blackboard();
    expect(bb.summarize()).toBe("No entries on the blackboard yet.");
  });

  it("summarize includes entry count and previews", () => {
    const bb = new Blackboard();
    bb.post("finding", "agent-tester", { title: "Missing label" });
    bb.post("coverage", "agent-scout", { summary: "5 pages mapped" });

    const summary = bb.summarize();
    expect(summary).toContain("2 entries");
    expect(summary).toContain("Missing label");
    expect(summary).toContain("5 pages mapped");
  });

  it("summarize respects maxEntries parameter", () => {
    const bb = new Blackboard();
    for (let i = 0; i < 30; i++) {
      bb.post("finding", "agent-tester", { title: `Bug ${i}` });
    }

    const summary = bb.summarize(5);
    expect(summary).toContain("30 entries");
    expect(summary).toContain("showing last 5");
    // Should contain the last 5 entries (Bug 25-29)
    expect(summary).toContain("Bug 29");
    expect(summary).not.toContain("Bug 0");
  });

  it("all() returns a copy of entries", () => {
    const bb = new Blackboard();
    bb.post("finding", "a", { title: "x" });
    const all = bb.all();
    expect(all).toHaveLength(1);
    // Mutating the returned array should not affect the blackboard
    (all as any[]).push({ id: "fake" });
    expect(bb.all()).toHaveLength(1);
  });
});
