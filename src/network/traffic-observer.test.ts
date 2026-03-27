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

describe("NetworkTrafficObserver", () => {
  it("records observed API responses and failed requests", () => {
    const observer = new NetworkTrafficObserver();
    const page = createMockPage();

    observer.attach(page as any, "primary");

    page.emit("response", {
      status: () => 200,
      url: () => "https://example.com/api/widgets?view=full",
      request: () => ({
        method: () => "GET",
        resourceType: () => "fetch",
      }),
    });
    page.emit("response", {
      status: () => 201,
      url: () => "https://example.com/api/widgets",
      request: () => ({
        method: () => "POST",
        resourceType: () => "xhr",
      }),
    });
    page.emit("requestfailed", {
      url: () => "https://example.com/api/widgets",
      method: () => "POST",
      resourceType: () => "xhr",
      failure: () => ({ errorText: "net::ERR_CONNECTION_RESET" }),
    });

    expect(observer.snapshot()).toEqual([
      {
        route: "/api/widgets",
        methods: ["GET", "POST"],
        statuses: [0, 200, 201],
        failures: ["net::ERR_CONNECTION_RESET"],
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
});
