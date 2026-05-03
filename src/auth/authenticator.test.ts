import { describe, expect, it, vi } from 'vitest';

import type { Stagehand } from '@browserbasehq/stagehand';

import { authenticate } from './authenticator.js';
import { authenticateNone } from './none.js';
import { authenticateStoredState } from './stored-state.js';

vi.mock('../browser/page-interface.js', () => ({
  adaptStagehand: vi.fn(() => ({
    getPrimaryPage: vi.fn(),
  })),
}));

vi.mock('./none.js', () => ({
  authenticateNone: vi.fn(),
}));

vi.mock('./stored-state.js', () => ({
  authenticateStoredState: vi.fn(),
}));

describe('authenticate', () => {
  it('dispatches to none strategy', async () => {
    vi.mocked(authenticateNone).mockResolvedValue();

    await authenticate(
      {} as Stagehand,
      {
        targetUrl: 'https://example.com',
        auth: {
          type: 'none',
        },
      } as const
    );

    expect(authenticateNone).toHaveBeenCalledTimes(1);
  });

  it('dispatches to stored-state strategy', async () => {
    vi.mocked(authenticateStoredState).mockResolvedValue();

    await authenticate(
      {} as Stagehand,
      {
        targetUrl: 'https://example.com',
        auth: {
          type: 'stored-state',
          stateFile: '/tmp/auth.json',
          successIndicator: {
            type: 'none',
          },
        },
      } as const
    );

    expect(authenticateStoredState).toHaveBeenCalledTimes(1);
  });
});
