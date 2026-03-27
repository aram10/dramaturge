export interface ObservedApiEndpoint {
  route: string;
  methods: string[];
  statuses: number[];
  failures: string[];
}

export class NetworkTrafficObserver {
  private endpoints = new Map<string, ObservedApiEndpoint>();
  private teardownFns = new Map<string, Array<() => void>>();

  attach(page: any, pageKey = "default"): void {
    if (this.teardownFns.has(pageKey)) {
      this.detach(pageKey);
    }

    const teardowns: Array<() => void> = [];

    const onResponse = (response: {
      status: () => number;
      url: () => string;
      request: () => { method: () => string; resourceType?: () => string };
    }) => {
      const request = response.request();
      const route = normalizeRoute(response.url());
      if (!shouldRecordRoute(route, request.resourceType?.())) return;

      this.record({
        route,
        method: request.method(),
        status: response.status(),
      });
    };
    page.on("response", onResponse);
    teardowns.push(() => page.off("response", onResponse));

    const onRequestFailed = (request: {
      url: () => string;
      method: () => string;
      resourceType?: () => string;
      failure: () => { errorText: string } | null;
    }) => {
      const route = normalizeRoute(request.url());
      if (!shouldRecordRoute(route, request.resourceType?.())) return;

      this.record({
        route,
        method: request.method(),
        status: 0,
        failure: request.failure()?.errorText,
      });
    };
    page.on("requestfailed", onRequestFailed);
    teardowns.push(() => page.off("requestfailed", onRequestFailed));

    this.teardownFns.set(pageKey, teardowns);
  }

  detach(pageKey?: string): void {
    if (pageKey) {
      const teardowns = this.teardownFns.get(pageKey) ?? [];
      for (const teardown of teardowns) teardown();
      this.teardownFns.delete(pageKey);
      return;
    }

    for (const teardowns of this.teardownFns.values()) {
      for (const teardown of teardowns) teardown();
    }
    this.teardownFns.clear();
  }

  snapshot(): ObservedApiEndpoint[] {
    return [...this.endpoints.values()].map((endpoint) => ({
      route: endpoint.route,
      methods: [...endpoint.methods],
      statuses: [...endpoint.statuses],
      failures: [...endpoint.failures],
    }));
  }

  private record(input: {
    route: string;
    method: string;
    status: number;
    failure?: string;
  }): void {
    const current = this.endpoints.get(input.route) ?? {
      route: input.route,
      methods: [],
      statuses: [],
      failures: [],
    };

    current.methods = uniqueSorted([...current.methods, input.method.toUpperCase()]);
    current.statuses = uniqueNumbers([...current.statuses, input.status]);
    if (input.failure) {
      current.failures = uniqueSorted([...current.failures, input.failure]);
    }

    this.endpoints.set(input.route, current);
  }
}

function normalizeRoute(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function shouldRecordRoute(route: string, resourceType?: string): boolean {
  if (resourceType === "fetch" || resourceType === "xhr") {
    return true;
  }

  return route.startsWith("/api/");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
