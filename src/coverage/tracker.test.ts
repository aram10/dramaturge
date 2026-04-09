// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from "vitest";
import { CoverageTracker } from "./tracker.js";
import type { CoverageEvent, BlindSpot } from "../types.js";

describe("CoverageTracker", () => {
  describe("discoverControl / discoverControls", () => {
    it("tracks discovered controls", () => {
      const tracker = new CoverageTracker();
      tracker.discoverControl("btn-save");
      tracker.discoverControls(["input-name", "input-email"]);

      const snap = tracker.snapshot();
      expect(snap.controlsDiscovered).toBe(3);
      expect(snap.controlsExercised).toBe(0);
    });

    it("deduplicates discovered controls", () => {
      const tracker = new CoverageTracker();
      tracker.discoverControl("btn-save");
      tracker.discoverControl("btn-save");

      const snap = tracker.snapshot();
      expect(snap.controlsDiscovered).toBe(1);
    });
  });

  describe("recordEvent", () => {
    it("records an event and marks control as discovered+exercised", () => {
      const tracker = new CoverageTracker();
      const event: CoverageEvent = {
        controlId: "btn-submit",
        action: "click",
        outcome: "worked",
        timestamp: new Date().toISOString(),
      };
      tracker.recordEvent(event);

      const snap = tracker.snapshot();
      expect(snap.controlsDiscovered).toBe(1);
      expect(snap.controlsExercised).toBe(1);
      expect(snap.events).toHaveLength(1);
      expect(snap.events[0].controlId).toBe("btn-submit");
    });

    it("deduplicates exercised controls across events", () => {
      const tracker = new CoverageTracker();
      const event1: CoverageEvent = {
        controlId: "btn-submit",
        action: "click",
        outcome: "worked",
        timestamp: new Date().toISOString(),
      };
      const event2: CoverageEvent = {
        controlId: "btn-submit",
        action: "click",
        outcome: "error",
        timestamp: new Date().toISOString(),
      };
      tracker.recordEvent(event1);
      tracker.recordEvent(event2);

      const snap = tracker.snapshot();
      expect(snap.controlsDiscovered).toBe(1);
      expect(snap.controlsExercised).toBe(1);
      expect(snap.events).toHaveLength(2);
    });
  });

  describe("snapshot", () => {
    it("returns a copy of events (not the internal array)", () => {
      const tracker = new CoverageTracker();
      tracker.recordEvent({
        controlId: "x",
        action: "click",
        outcome: "worked",
        timestamp: new Date().toISOString(),
      });

      const snap1 = tracker.snapshot();
      snap1.events.push({
        controlId: "injected",
        action: "click",
        outcome: "worked",
        timestamp: "",
      });

      const snap2 = tracker.snapshot();
      expect(snap2.events).toHaveLength(1); // original unchanged
    });
  });

  describe("blindSpots", () => {
    it("tracks blind spots", () => {
      const tracker = new CoverageTracker();
      const spot: BlindSpot = {
        nodeId: "node-1",
        summary: "Could not reach settings",
        reason: "state-unreachable",
        severity: "medium",
      };
      tracker.addBlindSpot(spot);

      const spots = tracker.getBlindSpots();
      expect(spots).toHaveLength(1);
      expect(spots[0].summary).toBe("Could not reach settings");
    });

    it("returns a copy of blind spots", () => {
      const tracker = new CoverageTracker();
      tracker.addBlindSpot({
        summary: "x",
        reason: "pruned",
        severity: "low",
      });

      const spots1 = tracker.getBlindSpots();
      spots1.push({
        summary: "injected",
        reason: "unknown",
        severity: "low",
      });

      expect(tracker.getBlindSpots()).toHaveLength(1);
    });
  });
});
