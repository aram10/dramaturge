import { describe, expect, it, vi } from 'vitest';
import { REDACTED_VALUE } from '../redaction.js';
import { ActionRecorder } from '../worker/action-recorder.js';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateOAuthRedirect } from './oauth-redirect.js';
import { waitForSuccess } from './success-indicator.js';

function createMockStagehand() {
  const goto = vi.fn().mockResolvedValue(undefined);
  const fill = vi.fn().mockResolvedValue(undefined);
  const click = vi.fn().mockResolvedValue(undefined);
  const waitForSelector = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto,
    fill,
    click,
    waitForSelector,
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
    spies: { goto, fill, click, waitForSelector },
  };
}

describe('authenticateOAuthRedirect', () => {
  it('runs scripted OAuth steps without creating a model agent', async () => {
    const { stagehand, page, spies } = createMockStagehand();
    const recorder = new ActionRecorder(page as any);
    recorder.start();

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
    expect(spies.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(spies.click).toHaveBeenNthCalledWith(1, "button[data-provider='microsoft']");
    expect(spies.waitForSelector).toHaveBeenNthCalledWith(1, "input[type='email']");
    expect(spies.fill).toHaveBeenNthCalledWith(1, "input[type='email']", 'user@example.com');
    expect(spies.click).toHaveBeenNthCalledWith(2, "button[type='submit']");
    expect(spies.waitForSelector).toHaveBeenNthCalledWith(2, "input[type='password']");
    expect(spies.fill).toHaveBeenNthCalledWith(2, "input[type='password']", 'super-secret');
    expect(waitForSuccess).toHaveBeenCalledWith(page, "selector:[data-testid='user-nav-button']");
    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'navigate',
        url: 'https://example.com/login',
      }),
      expect.objectContaining({
        kind: 'click',
        selector: "button[data-provider='microsoft']",
      }),
      expect.objectContaining({
        kind: 'input',
        selector: "input[type='email']",
        value: 'user@example.com',
      }),
      expect.objectContaining({
        kind: 'click',
        selector: "button[type='submit']",
      }),
      expect.objectContaining({
        kind: 'input',
        selector: "input[type='password']",
        value: REDACTED_VALUE,
      }),
    ]);
  });
});
