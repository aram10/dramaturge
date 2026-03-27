import { describe, it, expect, vi } from "vitest";
import { BrowserErrorCollector } from "./browser-errors.js";

function createMockPage() {
  const handlers = new Map<string, Function[]>();
  return {
    url: () => "https://example.com/test",
    on(event: string, fn: Function) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    off(event: string, fn: Function) {
      const list = handlers.get(event) ?? [];
      handlers.set(event, list.filter((f) => f !== fn));
    },
    emit(event: string, ...args: unknown[]) {
      const list = handlers.get(event) ?? [];
      for (const fn of list) fn(...args);
    },
    _handlers: handlers,
  };
}

describe("BrowserErrorCollector", () => {
  it("captures console errors", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: true,
      captureNetwork: false,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    // Simulate console error
    page.emit("console", { type: () => "error", text: () => "Uncaught TypeError: foo" });
    page.emit("console", { type: () => "log", text: () => "normal log" }); // should be ignored
    page.emit("console", { type: () => "warning", text: () => "deprecation warning" });

    expect(collector.pendingCount()).toBe(2);

    const { findings, evidence } = collector.flush();
    expect(findings).toHaveLength(2);
    expect(findings[0].title).toContain("console error");
    expect(findings[0].severity).toBe("Major");
    expect(findings[1].title).toContain("console warning");
    expect(findings[1].severity).toBe("Minor");
    expect(evidence).toHaveLength(2);
    expect(collector.pendingCount()).toBe(0);
  });

  it("captures page errors (uncaught exceptions)", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: true,
      captureNetwork: false,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    page.emit("pageerror", new Error("Cannot read properties of null"));

    const { findings } = collector.flush();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Critical");
    expect(findings[0].title).toContain("Uncaught exception");
  });

  it("captures network errors (4xx/5xx)", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: false,
      captureNetwork: true,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    // 404 response
    page.emit("response", {
      status: () => 404,
      url: () => "https://example.com/api/missing",
      statusText: () => "Not Found",
      request: () => ({ method: () => "GET" }),
    });
    // 500 response
    page.emit("response", {
      status: () => 500,
      url: () => "https://example.com/api/error",
      statusText: () => "Internal Server Error",
      request: () => ({ method: () => "POST" }),
    });
    // 200 response (should be ignored)
    page.emit("response", {
      status: () => 200,
      url: () => "https://example.com/api/ok",
      statusText: () => "OK",
      request: () => ({ method: () => "GET" }),
    });

    const { findings } = collector.flush();
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe("Minor"); // 404
    expect(findings[1].severity).toBe("Major"); // 500
  });

  it("captures failed requests (dns failures, etc.)", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: false,
      captureNetwork: true,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    page.emit("requestfailed", {
      url: () => "https://dead-host.example.com/api",
      method: () => "GET",
      failure: () => ({ errorText: "net::ERR_NAME_NOT_RESOLVED" }),
    });

    const { findings } = collector.flush();
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("Network failed");
    expect(findings[0].actual).toContain("net::ERR_NAME_NOT_RESOLVED");
  });

  it("deduplicates repeated console errors", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: true,
      captureNetwork: false,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    // Same error 3 times
    for (let i = 0; i < 3; i++) {
      page.emit("console", { type: () => "error", text: () => "ResizeObserver loop" });
    }

    const { findings } = collector.flush();
    expect(findings).toHaveLength(1); // grouped
    expect(findings[0].actual).toContain("3 occurrence(s)");
  });

  it("deduplicates repeated network errors by URL+status", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: false,
      captureNetwork: true,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    // Same 404 three times
    for (let i = 0; i < 3; i++) {
      page.emit("response", {
        status: () => 404,
        url: () => "https://example.com/missing.js",
        statusText: () => "Not Found",
        request: () => ({ method: () => "GET" }),
      });
    }

    const { findings } = collector.flush();
    expect(findings).toHaveLength(1);
    expect(findings[0].actual).toContain("3 occurrence(s)");
  });

  it("detach removes all listeners", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: true,
      captureNetwork: true,
      networkErrorMinStatus: 400,
    });
    const page = createMockPage();
    collector.attach(page as any);

    // Should have listeners
    expect(page._handlers.get("console")?.length).toBeGreaterThan(0);

    collector.detach();

    // All listeners removed
    for (const [, listeners] of page._handlers) {
      expect(listeners).toHaveLength(0);
    }
  });

  it("returns empty when nothing captured", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: true,
      captureNetwork: true,
      networkErrorMinStatus: 400,
    });

    const { findings, evidence } = collector.flush();
    expect(findings).toHaveLength(0);
    expect(evidence).toHaveLength(0);
  });

  it("respects networkErrorMinStatus threshold", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: false,
      captureNetwork: true,
      networkErrorMinStatus: 500, // only 500+
    });
    const page = createMockPage();
    collector.attach(page as any);

    page.emit("response", {
      status: () => 404,
      url: () => "https://example.com/not-found",
      statusText: () => "Not Found",
      request: () => ({ method: () => "GET" }),
    });
    page.emit("response", {
      status: () => 503,
      url: () => "https://example.com/unavailable",
      statusText: () => "Service Unavailable",
      request: () => ({ method: () => "GET" }),
    });

    const { findings } = collector.flush();
    expect(findings).toHaveLength(1); // only the 503
    expect(findings[0].title).toContain("503");
  });

  it("suppresses expected auth noise while preserving unexpected failures", () => {
    const collector = new BrowserErrorCollector({
      captureConsole: false,
      captureNetwork: true,
      networkErrorMinStatus: 400,
      policy: {
        expectedResponses: [
          {
            pathPrefix: "/api/manage/knowledge-bases",
            statuses: [401, 403],
          },
        ],
        ignoredConsolePatterns: [],
      },
    });
    const page = createMockPage();
    collector.attach(page as any);

    page.emit("response", {
      status: () => 401,
      url: () => "https://example.com/api/manage/knowledge-bases",
      statusText: () => "Unauthorized",
      request: () => ({ method: () => "GET" }),
    });
    page.emit("response", {
      status: () => 500,
      url: () => "https://example.com/api/manage/knowledge-bases",
      statusText: () => "Internal Server Error",
      request: () => ({ method: () => "GET" }),
    });

    const { findings } = collector.flush();
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("500");
  });
});
