import { describe, expect, it, vi } from 'vitest';

import { authenticateStoredState } from './stored-state.js';

const mocks = vi.hoisted(() => ({
  applyStorageState: vi.fn(),
  getPrimaryPage: vi.fn(),
  parseIndicator: vi.fn(),
  waitForSuccess: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: mocks.readFileSync,
}));

vi.mock('../browser/page-interface.js', () => ({
  getPrimaryPage: mocks.getPrimaryPage,
}));

vi.mock('./storage-state.js', () => ({
  applyStorageState: mocks.applyStorageState,
}));

vi.mock('./success-indicator.js', () => ({
  parseIndicator: mocks.parseIndicator,
  waitForSuccess: mocks.waitForSuccess,
}));

describe('authenticateStoredState', () => {
  it('applies the storage state and does not validate without an indicator', async () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ cookies: [], origins: [] }));
    mocks.applyStorageState.mockResolvedValue(undefined);
    mocks.getPrimaryPage.mockReturnValue({});

    await authenticateStoredState({}, 'https://example.com', '/tmp/state.json');

    expect(mocks.applyStorageState).toHaveBeenCalledTimes(1);
    expect(mocks.waitForSuccess).not.toHaveBeenCalled();
  });

  it('validates success when an indicator is provided', async () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ cookies: [], origins: [] }));
    mocks.applyStorageState.mockResolvedValue(undefined);
    mocks.getPrimaryPage.mockReturnValue({});
    mocks.parseIndicator.mockReturnValue({ type: 'text', value: 'ok' });
    mocks.waitForSuccess.mockResolvedValue(undefined);

    await authenticateStoredState({}, 'https://example.com', '/tmp/state.json', 'text:ok');

    expect(mocks.getPrimaryPage).toHaveBeenCalledTimes(2);
    expect(mocks.waitForSuccess).toHaveBeenCalledTimes(1);
  });
});
