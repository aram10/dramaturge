// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { emitEngineEvent } from './event-stream.js';
import type { EngineEventEmitter, LogLevel } from './event-stream.js';

const CONTEXT_SEPARATOR = ' ';

export interface EngineLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(scope: string): EngineLogger;
}

function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  try {
    return `${CONTEXT_SEPARATOR}${JSON.stringify(context)}`;
  } catch {
    return `${CONTEXT_SEPARATOR}[unserializable-context]`;
  }
}

/**
 * Console output remains human-oriented; structured consumers should prefer the
 * `log` engine event instead of parsing console lines.
 */
function writeLog(
  level: LogLevel,
  scope: string,
  message: string,
  context: Record<string, unknown> | undefined,
  eventStream?: EngineEventEmitter
): void {
  emitEngineEvent(eventStream, 'log', {
    level,
    scope,
    message,
    ...(context ? { context } : {}),
  });

  const line = `[dramaturge:${scope}] ${message}${formatContext(context)}`;
  switch (level) {
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

export function createEngineLogger(
  eventStream?: EngineEventEmitter,
  scope = 'engine'
): EngineLogger {
  return {
    info(message, context) {
      writeLog('info', scope, message, context, eventStream);
    },
    warn(message, context) {
      writeLog('warn', scope, message, context, eventStream);
    },
    error(message, context) {
      writeLog('error', scope, message, context, eventStream);
    },
    child(childScope) {
      return createEngineLogger(eventStream, `${scope}.${childScope}`);
    },
  };
}
