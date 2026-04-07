import { describe, expect, it, vi } from 'vitest';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateOAuthRedirect } from './oauth-redirect.js';
import { waitForSuccess } from './success-indicator.js';

function createMockStagehand() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
  };

  return {
    stagehand: {
      act: vi.fn(),
      agent: vi.fn(),
      context: {
        pages: () => [page],
      },
    },
    page,
  };
}

describe('authenticateOAuthRedirect', () => {
  it('runs scripted OAuth steps without creating a model agent', async () => {
    const { stagehand, page } = createMockStagehand();

    await authenticateOAuthRedirect(
      stagehand as any,
      'https://example.com/app',
      '/login',
      [
        { type: 'click', selector: "button[data-provider='microsoft']" },
        { type: 'wait-for-selector', selector: "input[type='email']" },
        { type: 'fill', selector: "input[type='email']", value: 'user@example.com', secret: false },
        { type: 'click', selector: "button[type='submit']" },
        { type: 'wait-for-selector', selector: "input[type='password']" },
        { type: 'fill', selector: "input[type='password']", value: 'super-secret', secret: true },
      ],
      "selector:[data-testid='user-nav-button']"
    );

    expect(stagehand.agent).not.toHaveBeenCalled();
    expect(stagehand.act).not.toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(page.click).toHaveBeenNthCalledWith(1, "button[data-provider='microsoft']");
    expect(page.waitForSelector).toHaveBeenNthCalledWith(1, "input[type='email']");
    expect(page.fill).toHaveBeenNthCalledWith(1, "input[type='email']", 'user@example.com');
    expect(page.click).toHaveBeenNthCalledWith(2, "button[type='submit']");
    expect(page.waitForSelector).toHaveBeenNthCalledWith(2, "input[type='password']");
    expect(page.fill).toHaveBeenNthCalledWith(2, "input[type='password']", 'super-secret');
    expect(waitForSuccess).toHaveBeenCalledWith(page, "selector:[data-testid='user-nav-button']");
  });
});
