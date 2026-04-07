import { describe, expect, it, vi } from 'vitest';
import { REDACTED_VALUE } from '../redaction.js';
import { ActionRecorder } from '../worker/action-recorder.js';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateForm } from './form.js';
import { waitForSuccess } from './success-indicator.js';

function createMockStagehand() {
  const goto = vi.fn().mockResolvedValue(undefined);
  const fill = vi.fn().mockResolvedValue(undefined);
  const click = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto,
    fill,
    click,
  };

  return {
    stagehand: {
      act: vi.fn(),
      context: {
        pages: () => [page],
      },
    },
    page,
    spies: { goto, fill, click },
  };
}

describe('authenticateForm', () => {
  it('fills configured selectors directly without using model actions', async () => {
    const { stagehand, page, spies } = createMockStagehand();
    const recorder = new ActionRecorder(page as any);
    recorder.start();

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
    expect(spies.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(spies.fill).toHaveBeenNthCalledWith(1, "input[name='email']", 'user@example.com');
    expect(spies.fill).toHaveBeenNthCalledWith(2, "input[name='password']", 'super-secret');
    expect(spies.click).toHaveBeenCalledWith("button[type='submit']");
    expect(waitForSuccess).toHaveBeenCalledWith(page, "selector:[data-testid='user-nav-button']");
    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'navigate',
        url: 'https://example.com/login',
      }),
      expect.objectContaining({
        kind: 'input',
        selector: "input[name='email']",
        value: 'user@example.com',
      }),
      expect.objectContaining({
        kind: 'input',
        selector: "input[name='password']",
        value: REDACTED_VALUE,
      }),
      expect.objectContaining({
        kind: 'click',
        selector: "button[type='submit']",
      }),
    ]);
  });
});
