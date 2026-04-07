import { describe, expect, it, vi } from 'vitest';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateForm } from './form.js';
import { waitForSuccess } from './success-indicator.js';

function createMockStagehand() {
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
  };

  return {
    stagehand: {
      act: vi.fn(),
      context: {
        pages: () => [page],
      },
    },
    page,
  };
}

describe('authenticateForm', () => {
  it('fills configured selectors directly without using model actions', async () => {
    const { stagehand, page } = createMockStagehand();

    await authenticateForm(
      stagehand as any,
      'https://example.com/app',
      '/login',
      [
        { selector: "input[name='email']", value: 'user@example.com', secret: false },
        { selector: "input[name='password']", value: 'super-secret', secret: true },
      ],
      { selector: "button[type='submit']", label: 'Sign in' },
      "selector:[data-testid='user-nav-button']"
    );

    expect(stagehand.act).not.toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(page.fill).toHaveBeenNthCalledWith(1, "input[name='email']", 'user@example.com');
    expect(page.fill).toHaveBeenNthCalledWith(2, "input[name='password']", 'super-secret');
    expect(page.click).toHaveBeenCalledWith("button[type='submit']");
    expect(waitForSuccess).toHaveBeenCalledWith(page, "selector:[data-testid='user-nav-button']");
  });
});
