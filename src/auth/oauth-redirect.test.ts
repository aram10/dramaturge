import { describe, expect, it, vi } from 'vitest';
import type { AuthBrowserPage, BrowserSessionLike } from '../browser/page-interface.js';
import { ActionRecorder } from '../worker/action-recorder.js';

vi.mock('./success-indicator.js', () => ({
  parseIndicator: vi.fn((value: string) => value),
  waitForSuccess: vi.fn().mockResolvedValue(undefined),
}));

import { authenticateOAuthRedirect } from './oauth-redirect.js';
import { waitForSuccess } from './success-indicator.js';

function createMockBrowser() {
  const goto = vi.fn().mockResolvedValue(undefined);
  const fill = vi.fn().mockResolvedValue(undefined);
  const click = vi.fn().mockResolvedValue(undefined);
  const waitForSelector = vi.fn().mockResolvedValue(undefined);
  const page = {
    goto,
    fill,
    click,
    waitForSelector,
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
    spies: { goto, fill, click, waitForSelector },
  };
}

describe('authenticateOAuthRedirect', () => {
  it('runs scripted OAuth steps without creating a model agent', async () => {
    const { browser, page, spies } = createMockBrowser();
    const recorder = new ActionRecorder(page);
    recorder.start();

    await authenticateOAuthRedirect(
      browser,
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

    expect(spies.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(spies.click).toHaveBeenNthCalledWith(1, "button[data-provider='microsoft']");
    expect(spies.waitForSelector).toHaveBeenNthCalledWith(1, "input[type='email']");
    expect(spies.fill).toHaveBeenNthCalledWith(1, "input[type='email']", 'user@example.com');
    expect(spies.click).toHaveBeenNthCalledWith(2, "button[type='submit']");
    expect(spies.waitForSelector).toHaveBeenNthCalledWith(2, "input[type='password']");
    expect(spies.fill).toHaveBeenNthCalledWith(2, "input[type='password']", 'super-secret');
    expect(waitForSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        goto: expect.any(Function),
        fill: expect.any(Function),
        click: expect.any(Function),
        waitForSelector: expect.any(Function),
      }),
      "selector:[data-testid='user-nav-button']"
    );
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
        value: undefined,
        redacted: true,
      }),
    ]);
  });

  it('falls back to locator.waitFor when waitForSelector is unavailable', async () => {
    const locator = {
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      waitFor: vi.fn().mockResolvedValue(undefined),
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

    await authenticateOAuthRedirect(
      browser,
      'https://example.com/app',
      '/login',
      [{ type: 'wait-for-selector', selector: "input[type='email']" }],
      "selector:[data-testid='user-nav-button']"
    );

    expect(page.locator).toHaveBeenCalledWith("input[type='email']");
    expect(locator.waitFor).toHaveBeenCalled();
  });
});
