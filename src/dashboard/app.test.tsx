import { Box, Text } from 'ink';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

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
  it('renders a header label without crashing', () => {
    const eventStream = makeEventStream();

    const output = renderToString(
      <Box>
        <Text>
          <Dashboard eventStream={eventStream} />
        </Text>
      </Box>
    );

    expect(output).toContain('Dramaturge Dashboard');
  });
});
