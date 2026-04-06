import React from "react";
import { render } from "ink";
import type { EngineEventEmitter } from "../engine/event-stream.js";
import { Dashboard } from "./app.js";

/**
 * Render the real-time Ink terminal dashboard.
 *
 * Returns a cleanup function that should be called after the engine run
 * completes to unmount the Ink instance gracefully.
 */
export function renderDashboard(eventStream: EngineEventEmitter): {
  /** Call after the run finishes to unmount the dashboard. */
  cleanup: () => void;
  /** Resolves when the Ink instance has fully unmounted. */
  waitUntilExit: Promise<void>;
} {
  const instance = render(React.createElement(Dashboard, { eventStream }));

  return {
    cleanup: () => instance.unmount(),
    waitUntilExit: instance.waitUntilExit(),
  };
}
