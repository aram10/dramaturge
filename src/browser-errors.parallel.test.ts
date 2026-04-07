import { describe, expect, it } from 'vitest';
import { BrowserErrorCollector } from './browser-errors.js';

function createMockPage(url: string) {
  const handlers = new Map<string, Function[]>();
  return {
    url: () => url,
    on(event: string, fn: Function) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    off(event: string, fn: Function) {
      const list = handlers.get(event) ?? [];
      handlers.set(
        event,
        list.filter((handler) => handler !== fn)
      );
    },
    emit(event: string, ...args: unknown[]) {
      const list = handlers.get(event) ?? [];
      for (const fn of list) fn(...args);
    },
  };
}

describe('BrowserErrorCollector page isolation', () => {
  it('flushes only the errors captured for the requested page key', () => {
    const collector = new BrowserErrorCollector({
      captureConsole: false,
      captureConsoleWarnings: false,
      captureNetwork: true,
      networkErrorMinStatus: 400,
    });

    const pageA = createMockPage('https://example.com/a');
    const pageB = createMockPage('https://example.com/b');

    collector.attach(pageA as any, 'page-a');
    collector.attach(pageB as any, 'page-b');

    pageA.emit('response', {
      status: () => 401,
      url: () => 'https://example.com/api/protected',
      statusText: () => 'Unauthorized',
      request: () => ({ method: () => 'GET' }),
    });

    pageB.emit('response', {
      status: () => 500,
      url: () => 'https://example.com/api/error',
      statusText: () => 'Internal Server Error',
      request: () => ({ method: () => 'POST' }),
    });

    const pageBFlush = collector.flush('page-b');

    expect(pageBFlush.findings).toHaveLength(1);
    expect(pageBFlush.findings[0].title).toContain('500');
    expect(collector.pendingCount('page-a')).toBe(1);
    expect(collector.pendingCount('page-b')).toBe(0);
  });
});
