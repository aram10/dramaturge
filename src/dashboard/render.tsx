import React from "react";
import { render } from "ink";
import type { EngineEventEmitter } from "../engine/event-stream.js";
import type { Blackboard } from "../a2a/blackboard.js";
import type { MessageBus } from "../a2a/message-bus.js";
import { Dashboard } from "./app.js";

export interface RenderDashboardOptions {
  blackboard?: Blackboard;
  messageBus?: MessageBus;
}

/**
 * Render the real-time Ink terminal dashboard.
 *
 * Returns a cleanup function that should be called after the engine run
 * completes to unmount the Ink instance gracefully.
 */
export function renderDashboard(
  eventStream: EngineEventEmitter,
  options?: RenderDashboardOptions
): {
  /** Call after the run finishes to unmount the dashboard. */
  cleanup: () => void;
  /** Resolves when the Ink instance has fully unmounted. */
  waitUntilExit: Promise<void>;
} {
  const instance = render(
    React.createElement(Dashboard, {
      eventStream,
      blackboard: options?.blackboard,
      messageBus: options?.messageBus,
    })
  );

  return {
    cleanup: () => instance.unmount(),
    waitUntilExit: instance.waitUntilExit(),
  };
}
