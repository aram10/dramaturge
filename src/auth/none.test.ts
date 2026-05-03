import { describe, expect, it, vi } from 'vitest';

import { authenticateNone } from './none.js';

const mocks = vi.hoisted(() => ({
  getPrimaryPage: vi.fn(),
}));

vi.mock('../browser/page-interface.js', () => ({
  getPrimaryPage: mocks.getPrimaryPage,
}));

describe('authenticateNone', () => {
  it('navigates the primary page to the target URL', async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    mocks.getPrimaryPage.mockReturnValue({
      goto,
    });

    await authenticateNone({} as never, 'https://example.com');

    expect(mocks.getPrimaryPage).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith('https://example.com');
  });
});
