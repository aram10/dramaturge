import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from 'ink-testing-library';

import { Dashboard } from './app.js';

function makeEventStream() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    },
  };
}

describe('Dashboard', () => {
  it('renders without crashing', () => {
    const eventStream = makeEventStream();
    const { lastFrame } = render(<Dashboard eventStream={eventStream as never} />);
    expect(lastFrame()).toBeTypeOf('string');
  });
});
