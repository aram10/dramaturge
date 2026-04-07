import { describe, it, expect, vi } from "vitest";
import { MessageBus } from "./message-bus.js";

describe("MessageBus", () => {
  it("starts with no messages", () => {
    const bus = new MessageBus();
    expect(bus.size()).toBe(0);
    expect(bus.getHistory()).toEqual([]);
  });

  it("sends a message and records it in history", () => {
    const bus = new MessageBus();
    const msg = bus.sendText("agent-scout", "agent-reviewer", "Found 3 pages");

    expect(msg.id).toMatch(/^msg-/);
    expect(msg.fromAgent).toBe("agent-scout");
    expect(msg.toAgent).toBe("agent-reviewer");
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toEqual({ kind: "text", text: "Found 3 pages" });
    expect(msg.role).toBe("agent");
    expect(msg.timestamp).toBeTruthy();
    expect(bus.size()).toBe(1);
  });

  it("delivers point-to-point messages to the target agent", () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.onMessage("agent-reviewer", handler);

    bus.sendText("agent-scout", "agent-reviewer", "Found 3 pages");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ fromAgent: "agent-scout", toAgent: "agent-reviewer" })
    );
  });

  it("does not deliver point-to-point messages to other agents", () => {
    const bus = new MessageBus();
    const scoutHandler = vi.fn();
    const reviewerHandler = vi.fn();
    bus.onMessage("agent-scout", scoutHandler);
    bus.onMessage("agent-reviewer", reviewerHandler);

    bus.sendText("agent-tester", "agent-reviewer", "Bug found");

    expect(scoutHandler).not.toHaveBeenCalled();
    expect(reviewerHandler).toHaveBeenCalledTimes(1);
  });

  it("broadcasts messages to all registered handlers", () => {
    const bus = new MessageBus();
    const scoutHandler = vi.fn();
    const testerHandler = vi.fn();
    bus.onMessage("agent-scout", scoutHandler);
    bus.onMessage("agent-tester", testerHandler);

    bus.sendText("coordinator", "*", "Focus on forms");

    expect(scoutHandler).toHaveBeenCalledTimes(1);
    expect(testerHandler).toHaveBeenCalledTimes(1);
  });

  it("broadcast listeners see all messages including point-to-point", () => {
    const bus = new MessageBus();
    const anyHandler = vi.fn();
    bus.onAny(anyHandler);

    bus.sendText("agent-scout", "agent-reviewer", "A finding");
    bus.sendText("coordinator", "*", "Broadcast");

    expect(anyHandler).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops delivery for onMessage", () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    const unsub = bus.onMessage("agent-reviewer", handler);

    bus.sendText("agent-scout", "agent-reviewer", "msg1");
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.sendText("agent-scout", "agent-reviewer", "msg2");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops delivery for onAny", () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    const unsub = bus.onAny(handler);

    bus.sendText("a", "b", "msg1");
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.sendText("a", "b", "msg2");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("sends structured messages with multiple parts", () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.onMessage("agent-tester", handler);

    bus.send("coordinator", "agent-tester", [
      { kind: "text", text: "Test this form" },
      { kind: "data", mimeType: "application/json", data: { formId: "login" } },
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0][0];
    expect(msg.parts).toHaveLength(2);
    expect(msg.parts[0].kind).toBe("text");
    expect(msg.parts[1].kind).toBe("data");
  });

  it("supports correlation IDs for request/response pairs", () => {
    const bus = new MessageBus();
    const msg1 = bus.sendText("agent-scout", "agent-reviewer", "Review this", {
      correlationId: "corr-1",
    });
    const msg2 = bus.sendText("agent-reviewer", "agent-scout", "Looks good", {
      correlationId: "corr-1",
    });

    expect(msg1.correlationId).toBe("corr-1");
    expect(msg2.correlationId).toBe("corr-1");
  });

  it("supports metadata on messages", () => {
    const bus = new MessageBus();
    const msg = bus.sendText("coordinator", "agent-tester", "Do this", {
      role: "coordinator",
      metadata: { priority: "high" },
    });

    expect(msg.role).toBe("coordinator");
    expect(msg.metadata?.priority).toBe("high");
  });

  it("getMessagesFrom filters by sender", () => {
    const bus = new MessageBus();
    bus.sendText("agent-scout", "agent-reviewer", "msg1");
    bus.sendText("agent-tester", "agent-reviewer", "msg2");
    bus.sendText("agent-scout", "agent-tester", "msg3");

    const fromScout = bus.getMessagesFrom("agent-scout");
    expect(fromScout).toHaveLength(2);
    expect(fromScout.every((m) => m.fromAgent === "agent-scout")).toBe(true);
  });

  it("getMessagesTo filters by recipient including broadcasts", () => {
    const bus = new MessageBus();
    bus.sendText("agent-scout", "agent-reviewer", "direct");
    bus.sendText("coordinator", "*", "broadcast");
    bus.sendText("agent-tester", "agent-scout", "other");

    const toReviewer = bus.getMessagesTo("agent-reviewer");
    expect(toReviewer).toHaveLength(2); // direct + broadcast
  });
});
