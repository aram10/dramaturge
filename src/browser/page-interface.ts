import type { Stagehand } from '@browserbasehq/stagehand';
import type { ApiRequestContextLike } from '../api/types.js';

export interface BrowserLocatorLike {
  click?(): Promise<unknown>;
  count?(): Promise<number>;
  fill?(value: string): Promise<unknown>;
  waitFor?(): Promise<unknown>;
}

export interface BrowserPageLike {
  evaluate?: {
    <Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
    <Arg, Result>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>;
  };
  locator?(selector: string): unknown;
  request?: unknown;
  screenshot?(options?: Record<string, unknown>): Promise<Buffer>;
  url?(): string;
  viewportSize?(): { width: number; height: number } | null | undefined;
}

export interface BrowserContextLike<TPage extends BrowserPageLike = BrowserPageLike> {
  addCookies?(
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
    }>
  ): Promise<unknown>;
  cookies?(): Promise<
    Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'Strict' | 'Lax' | 'None';
    }>
  >;
  pages(): TPage[];
}

export interface BrowserSessionLike<TPage extends BrowserPageLike = BrowserPageLike> {
  context: BrowserContextLike<TPage>;
}

export interface AuthBrowserPage extends BrowserPageLike {
  click?(selector: string): Promise<unknown>;
  evaluate: {
    <Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
    <Arg, Result>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>;
  };
  fill?(selector: string, value: string): Promise<unknown>;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  locator(selector: string): BrowserLocatorLike;
  url(): string;
  waitForSelector?(selector: string): Promise<unknown>;
}

export interface DeterministicAuthPage extends AuthBrowserPage {
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  waitForSelector(selector: string): Promise<unknown>;
}

export type SuccessIndicatorPage = AuthBrowserPage;

export type StorageStatePage = AuthBrowserPage;

export interface WorkerToolPage extends BrowserPageLike {
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  url(): string;
}

export interface VisualRegressionPage extends BrowserPageLike {
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
}

export interface ActionRecorderPage {
  click?: (...args: unknown[]) => Promise<unknown>;
  fill?: (...args: unknown[]) => Promise<unknown>;
  getByAltText?(altText: string): unknown;
  getByLabel?(label: string): unknown;
  getByPlaceholder?(placeholder: string): unknown;
  getByRole?(role: string, options?: { name?: unknown }): unknown;
  getByTestId?(testId: string): unknown;
  getByText?(text: string): unknown;
  getByTitle?(title: string): unknown;
  goBack?: (...args: unknown[]) => Promise<unknown>;
  goForward?: (...args: unknown[]) => Promise<unknown>;
  goto?: (...args: unknown[]) => Promise<unknown>;
  keyboard?: {
    press: (...args: unknown[]) => Promise<unknown>;
  };
  locator?(selector: string): unknown;
  press?: (...args: unknown[]) => Promise<unknown>;
  reload?: (...args: unknown[]) => Promise<unknown>;
  selectOption?: (...args: unknown[]) => Promise<unknown>;
  type?: (...args: unknown[]) => Promise<unknown>;
  uncheck?: (...args: unknown[]) => Promise<unknown>;
  check?: (...args: unknown[]) => Promise<unknown>;
}

export function adaptStagehand(stagehand: Stagehand): BrowserSessionLike<AuthBrowserPage> {
  return stagehand as unknown as BrowserSessionLike<AuthBrowserPage>;
}

export function getPrimaryPage<TPage extends BrowserPageLike>(
  session: BrowserSessionLike<TPage>,
  reason: string
): TPage {
  const page = session.context.pages()[0];
  if (!page) {
    throw new Error(`No browser page available for ${reason}.`);
  }
  return page;
}

export function adaptDeterministicAuthPage(page: AuthBrowserPage): DeterministicAuthPage {
  return {
    ...page,
    click: async (selector: string) => {
      if (typeof page.click === 'function') {
        await page.click(selector);
        return;
      }
      if (typeof page.locator === 'function') {
        const locator = page.locator(selector);
        if (typeof locator.click === 'function') {
          await locator.click();
          return;
        }
      }
      throw new Error(`Page does not support deterministic click for selector: ${selector}`);
    },
    fill: async (selector: string, value: string) => {
      if (typeof page.fill === 'function') {
        await page.fill(selector, value);
        return;
      }
      if (typeof page.locator === 'function') {
        const locator = page.locator(selector);
        if (typeof locator.fill === 'function') {
          await locator.fill(value);
          return;
        }
      }
      throw new Error(`Page does not support deterministic fill for selector: ${selector}`);
    },
    waitForSelector: async (selector: string) => {
      if (typeof page.waitForSelector === 'function') {
        await page.waitForSelector(selector);
        return;
      }
      if (typeof page.locator === 'function') {
        const locator = page.locator(selector);
        if (typeof locator.waitFor === 'function') {
          await locator.waitFor();
          return;
        }
      }
      throw new Error(`Page does not support selector waiting for: ${selector}`);
    },
  };
}

export function hasEvaluate(page: unknown): page is {
  evaluate: NonNullable<BrowserPageLike['evaluate']>;
} {
  return typeof (page as BrowserPageLike | undefined)?.evaluate === 'function';
}

export function hasRequestContext(page: unknown): page is { request: ApiRequestContextLike } {
  const request = (page as BrowserPageLike | undefined)?.request;
  return typeof request === 'object' && request != null && 'fetch' in request;
}

export function hasScreenshot(page: unknown): page is {
  screenshot: NonNullable<BrowserPageLike['screenshot']>;
} {
  return typeof (page as BrowserPageLike | undefined)?.screenshot === 'function';
}
