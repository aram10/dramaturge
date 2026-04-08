import { describe, expect, it, vi } from 'vitest';
import type { AuthBrowserPage, BrowserSessionLike } from '../browser/page-interface.js';
import { ActionRecorder } from '../worker/action-recorder.js';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateForm } from './form.js';
import { waitForSuccess } from './success-indicator.js';

function createMockBrowser() {
  const goto = vi.fn().mockResolvedValue(undefined);
  const fill = vi.fn().mockResolvedValue(undefined);
  const click = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto,
    fill,
    click,
    locator: vi.fn(),
    url: vi.fn().mockReturnValue('https://example.com/login'),
    evaluate: vi.fn(),
  };

  return {
    browser: {
      context: {
        pages: () => [page],
      },
    } satisfies BrowserSessionLike<AuthBrowserPage>,
    page,
    spies: { goto, fill, click },
  };
}

describe('authenticateForm', () => {
  it('fills configured selectors directly without using model actions', async () => {
    const { browser, page, spies } = createMockBrowser();
    const recorder = new ActionRecorder(page);
    recorder.start();

    await authenticateForm(
      browser,
      'https://example.com/app',
      '/login',
      [
        { selector: "input[name='email']", value: 'user@example.com', secret: false },
        { selector: "input[name='password']", value: 'super-secret', secret: true },
      ],
      { selector: "button[type='submit']", label: 'Sign in' },
      "selector:[data-testid='user-nav-button']"
    );

    expect(spies.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(spies.fill).toHaveBeenNthCalledWith(1, "input[name='email']", 'user@example.com');
    expect(spies.fill).toHaveBeenNthCalledWith(2, "input[name='password']", 'super-secret');
    expect(spies.click).toHaveBeenCalledWith("button[type='submit']");
    expect(waitForSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        goto: expect.any(Function),
        fill: expect.any(Function),
        click: expect.any(Function),
      }),
      "selector:[data-testid='user-nav-button']"
    );
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
        value: undefined,
        redacted: true,
      }),
      expect.objectContaining({
        kind: 'click',
        selector: "button[type='submit']",
      }),
    ]);
  });

  it('falls back to locator-based interactions when direct page methods are unavailable', async () => {
    const locator = {
      fill: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      locator: vi.fn().mockReturnValue(locator),
      url: vi.fn().mockReturnValue('https://example.com/login'),
      evaluate: vi.fn(),
    };
    const browser = {
      context: {
        pages: () => [page],
      },
    } satisfies BrowserSessionLike<AuthBrowserPage>;

    await authenticateForm(
      browser,
      'https://example.com/app',
      '/login',
      [{ selector: "input[name='email']", value: 'user@example.com', secret: false }],
      { selector: "button[type='submit']", label: 'Sign in' },
      "selector:[data-testid='user-nav-button']"
    );

    expect(page.locator).toHaveBeenNthCalledWith(1, "input[name='email']");
    expect(locator.fill).toHaveBeenCalledWith('user@example.com');
    expect(page.locator).toHaveBeenNthCalledWith(2, "button[type='submit']");
    expect(locator.click).toHaveBeenCalled();
  });
});
