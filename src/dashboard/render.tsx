// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import React from 'react';
import { render } from 'ink';
import type { EngineEventEmitter } from '../engine/event-stream.js';
import type { Blackboard } from '../a2a/blackboard.js';
import type { MessageBus } from '../a2a/message-bus.js';
import { Dashboard } from './app.js';

/**
 * Options accepted by {@link renderDashboard}.
 *
 * @deprecated A2A coordination is now bridged into the engine event stream
 * automatically. Pass only `eventStream`; this options bag is accepted for
 * backward compatibility but is otherwise ignored.
 */
export interface RenderDashboardOptions {
  /** @deprecated No longer used. Ignored. */
  blackboard?: Blackboard;
  /** @deprecated No longer used. Ignored. */
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
  /** @deprecated Accepted for backward compatibility; ignored at runtime. */
  _options?: RenderDashboardOptions
): {
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
