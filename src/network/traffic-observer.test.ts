import { describe, expect, it } from "vitest";
import { NetworkTrafficObserver } from "./traffic-observer.js";

function createMockPage() {
  const handlers = new Map<string, Function[]>();
  return {
    on(event: string, fn: Function) {
      const list = handlers.get(event) ?? [];
      list.push(fn);
      handlers.set(event, list);
    },
    off(event: string, fn: Function) {
      const list = handlers.get(event) ?? [];
      handlers.set(event, list.filter((candidate) => candidate !== fn));
    },
    emit(event: string, ...args: unknown[]) {
      const list = handlers.get(event) ?? [];
      for (const fn of list) fn(...args);
    },
    _handlers: handlers,
  };
}

async function flushObserverWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("NetworkTrafficObserver", () => {
  it("records observed API responses and failed requests", async () => {
    const observer = new NetworkTrafficObserver();
    const page = createMockPage();

    observer.attach(page as any, "primary");

    page.emit("response", {
      status: () => 200,
      url: () => "https://example.com/api/widgets?view=full",
      request: () => ({
        method: () => "GET",
        resourceType: () => "fetch",
        headers: () => ({
          accept: "application/json",
        }),
        postData: () => null,
      }),
      headers: () => ({
        "content-type": "application/json",
      }),
      text: async () => '{"items":[]}',
    });
    page.emit("response", {
      status: () => 201,
      url: () => "https://example.com/api/widgets",
      request: () => ({
        method: () => "POST",
        resourceType: () => "xhr",
        headers: () => ({
          "content-type": "application/json",
          cookie: "session=secret",
          authorization: "Bearer secret-token",
          "x-csrf-token": "csrf-secret",
          "x-api-key": "api-secret",
        }),
        postData: () => '{"name":"Widget","csrfToken":"hidden"}',
      }),
      headers: () => ({
        "content-type": "application/json",
      }),
      text: async () => '{"id":"widget-1"}',
    });
    page.emit("requestfailed", {
      url: () => "https://example.com/api/widgets",
      method: () => "POST",
      resourceType: () => "xhr",
      failure: () => ({ errorText: "net::ERR_CONNECTION_RESET" }),
    });

    await flushObserverWork();

    expect(observer.snapshot()).toEqual([
      {
        route: "/api/widgets",
        methods: ["GET", "POST"],
        statuses: [0, 200, 201],
        failures: ["net::ERR_CONNECTION_RESET"],
        samples: [
          {
            method: "GET",
            status: 200,
            url: "/api/widgets?view=full",
            headers: {
              accept: "application/json",
            },
            responseBody: {
              items: [],
            },
          },
          {
            method: "POST",
            status: 201,
            url: "/api/widgets",
            headers: {
              authorization: "[REDACTED]",
              cookie: "[REDACTED]",
              "content-type": "application/json",
              "x-api-key": "[REDACTED]",
              "x-csrf-token": "[REDACTED]",
            },
            data: {
              csrfToken: "[REDACTED]",
              name: "Widget",
            },
            responseBody: {
              id: "widget-1",
            },
          },
          {
            method: "POST",
            status: 0,
            url: "/api/widgets",
            failure: "net::ERR_CONNECTION_RESET",
          },
        ],
      },
    ]);
  });

  it("ignores non-API document and asset requests", () => {
    const observer = new NetworkTrafficObserver();
    const page = createMockPage();

    observer.attach(page as any, "primary");

    page.emit("response", {
      status: () => 200,
      url: () => "https://example.com/dashboard",
      request: () => ({
        method: () => "GET",
        resourceType: () => "document",
      }),
    });
    page.emit("response", {
      status: () => 200,
      url: () => "https://example.com/assets/app.js",
      request: () => ({
        method: () => "GET",
        resourceType: () => "script",
      }),
    });

    expect(observer.snapshot()).toEqual([]);
  });

  it("deduplicates listeners when attaching the same page key twice", () => {
    const observer = new NetworkTrafficObserver();
    const page = createMockPage();

    observer.attach(page as any, "shared");
    const initialResponseListeners = page._handlers.get("response")?.length ?? 0;
    const initialFailedListeners = page._handlers.get("requestfailed")?.length ?? 0;

    observer.attach(page as any, "shared");

    expect(page._handlers.get("response")).toHaveLength(initialResponseListeners);
    expect(page._handlers.get("requestfailed")).toHaveLength(initialFailedListeners);
  });

  it("resets page-scoped traffic without losing the global catalog", async () => {
    const observer = new NetworkTrafficObserver();
    const page = createMockPage();

    observer.attach(page as any, "primary");

    page.emit("response", {
      status: () => 200,
      url: () => "https://example.com/api/widgets",
      request: () => ({
        method: () => "GET",
        resourceType: () => "fetch",
      }),
    });

    await flushObserverWork();

    expect(observer.snapshot("primary")).toEqual([
      {
        route: "/api/widgets",
        methods: ["GET"],
        statuses: [200],
        failures: [],
        samples: [
          {
            method: "GET",
            status: 200,
            url: "/api/widgets",
          },
        ],
      },
    ]);

    observer.resetPage("primary");

    expect(observer.snapshot("primary")).toEqual([]);
    expect(observer.snapshot()).toEqual([
      {
        route: "/api/widgets",
        methods: ["GET"],
        statuses: [200],
        failures: [],
        samples: [
          {
            method: "GET",
            status: 200,
            url: "/api/widgets",
          },
        ],
      },
    ]);
  });

  it("redacts custom auth and session-oriented headers in failed request samples", async () => {
    const observer = new NetworkTrafficObserver();
    const page = createMockPage();

    observer.attach(page as any, "primary");

    page.emit("requestfailed", {
      url: () => "https://example.com/api/session",
      method: () => "GET",
      resourceType: () => "xhr",
      headers: () => ({
        "x-session-token": "session-secret",
        "x-xsrf-token": "xsrf-secret",
      }),
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    });

    await flushObserverWork();

    expect(observer.snapshot()).toEqual([
      {
        route: "/api/session",
        methods: ["GET"],
        statuses: [0],
        failures: ["net::ERR_ABORTED"],
        samples: [
          {
            method: "GET",
            status: 0,
            url: "/api/session",
            headers: {
              "x-session-token": "[REDACTED]",
              "x-xsrf-token": "[REDACTED]",
            },
            failure: "net::ERR_ABORTED",
          },
        ],
      },
    ]);
  });
});
