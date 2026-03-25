import type { CoverageEvent, CoverageSnapshot, BlindSpot } from "../types.js";

/**
 * Tracks control-level coverage during a worker's exploration of an area.
 * Collects events reported by the worker via the mark_control_exercised tool.
 */
export class CoverageTracker {
  private discovered = new Set<string>();
  private exercised = new Set<string>();
  private events: CoverageEvent[] = [];
  private blindSpots: BlindSpot[] = [];

  /**
   * Register a control as discovered (seen on the page).
   */
  discoverControl(controlId: string): void {
    this.discovered.add(controlId);
  }

  /**
   * Register multiple controls as discovered.
   */
  discoverControls(controlIds: string[]): void {
    for (const id of controlIds) {
      this.discovered.add(id);
    }
  }

  /**
   * Record that a control was exercised by the worker.
   */
  recordEvent(event: CoverageEvent): void {
    this.discovered.add(event.controlId);
    this.exercised.add(event.controlId);
    this.events.push(event);
  }

  /**
   * Get a snapshot of current coverage state.
   */
  snapshot(): CoverageSnapshot {
    return {
      controlsDiscovered: this.discovered.size,
      controlsExercised: this.exercised.size,
      events: [...this.events],
    };
  }

  addBlindSpot(spot: BlindSpot): void {
    this.blindSpots.push(spot);
  }

  getBlindSpots(): BlindSpot[] {
    return [...this.blindSpots];
  }
}
