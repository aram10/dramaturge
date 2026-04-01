import { redactSensitiveValue, sanitizeHeaders, truncateString } from "../redaction.js";

export interface ObservedApiRequestSample {
  method: string;
  status: number;
  url: string;
  headers?: Record<string, string>;
  data?: unknown;
  responseBody?: unknown;
  failure?: string;
}

export interface ObservedApiEndpoint {
  route: string;
  methods: string[];
  statuses: number[];
  failures: string[];
  samples?: ObservedApiRequestSample[];
  responses?: Array<{
    status: number;
    body?: unknown;
  }>;
}

const MAX_SAMPLES_PER_ENDPOINT = 8;

interface ResponseLike {
  status: () => number;
  url: () => string;
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  allHeaders?: () => Promise<Record<string, string>>;
  text?: () => Promise<string>;
  request: () => RequestLike;
}

interface RequestLike {
  method: () => string;
  url?: () => string;
  resourceType?: () => string;
  headers?: () => Record<string, string>;
  allHeaders?: () => Promise<Record<string, string>>;
  postData?: () => string | null;
  failure?: () => { errorText: string } | null;
}

export class NetworkTrafficObserver {
  private endpoints = new Map<string, ObservedApiEndpoint>();
  private pageEndpoints = new Map<string, Map<string, ObservedApiEndpoint>>();
  private teardownFns = new Map<string, Array<() => void>>();

  attach(page: any, pageKey = "default"): void {
    if (this.teardownFns.has(pageKey)) {
      this.detach(pageKey);
    }

    const teardowns: Array<() => void> = [];

    const onResponse = (response: ResponseLike) => {
      void this.recordResponse(pageKey, response).catch(() => {
        /* best-effort: recording failures should not crash the observer */
      });
    };
    page.on("response", onResponse);
    teardowns.push(() => page.off("response", onResponse));

    const onRequestFailed = (request: RequestLike) => {
      const route = normalizeRoute(request.url?.() ?? "");
      if (!shouldRecordRoute(route, request.resourceType?.())) return;

      const headers = sanitizeHeaders(readHeadersSync(request));

      this.record({
        pageKey,
        route,
        method: request.method(),
        status: 0,
        failure: request.failure?.()?.errorText,
        sample: {
          method: request.method().toUpperCase(),
          status: 0,
          url: normalizeRequestUrl(request.url?.() ?? route),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          failure: request.failure?.()?.errorText ?? undefined,
        },
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

  resetPage(pageKey: string): void {
    this.pageEndpoints.set(pageKey, new Map());
  }

  snapshot(pageKey?: string): ObservedApiEndpoint[] {
    const source = pageKey
      ? this.pageEndpoints.get(pageKey) ?? new Map<string, ObservedApiEndpoint>()
      : this.endpoints;

    return [...source.values()].map((endpoint) => ({
      route: endpoint.route,
      methods: [...endpoint.methods],
      statuses: [...endpoint.statuses],
      failures: [...endpoint.failures],
      ...(endpoint.samples && endpoint.samples.length > 0
        ? {
            samples: endpoint.samples.map((sample) => ({
              method: sample.method,
              status: sample.status,
              url: sample.url,
              ...(sample.headers ? { headers: { ...sample.headers } } : {}),
              ...(sample.data !== undefined ? { data: sample.data } : {}),
              ...(sample.responseBody !== undefined
                ? { responseBody: sample.responseBody }
                : {}),
              ...(sample.failure ? { failure: sample.failure } : {}),
            })),
          }
        : {}),
      ...(endpoint.responses && endpoint.responses.length > 0
        ? {
            responses: endpoint.responses.map((response) => ({
              status: response.status,
              body: response.body,
            })),
          }
        : {}),
    }));
  }

  private async recordResponse(pageKey: string, response: ResponseLike): Promise<void> {
    const request = response.request();
    const route = normalizeRoute(response.url());
    if (!shouldRecordRoute(route, request.resourceType?.())) return;

    const sample: ObservedApiRequestSample = {
      method: request.method().toUpperCase(),
      status: response.status(),
      url: normalizeRequestUrl(response.url()),
    };

    const syncRequestHeaders = sanitizeHeaders(readHeadersSync(request));
    if (Object.keys(syncRequestHeaders).length > 0) {
      sample.headers = syncRequestHeaders;
    }
    const requestData = parseRequestData(
      request.postData?.(),
      syncRequestHeaders["content-type"]
    );
    if (requestData !== undefined) {
      sample.data = requestData;
    }

    this.record({
      pageKey,
      route,
      method: request.method(),
      status: response.status(),
      sample,
    });

    const asyncHeaders = sanitizeHeaders(await readHeaders(request));
    if (Object.keys(asyncHeaders).length > 0) {
      sample.headers = asyncHeaders;
    }

    const responseHeaders = await readHeaders(response);
    const responseBody = parseResponseBody(
      responseHeaders["content-type"],
      await readResponseText(response)
    );
    if (responseBody !== undefined) {
      sample.responseBody = responseBody;
    }
  }

  private record(input: {
    pageKey: string;
    route: string;
    method: string;
    status: number;
    failure?: string;
    sample?: ObservedApiRequestSample;
  }): void {
    this.recordInto(this.endpoints, input);
    const pageMap =
      this.pageEndpoints.get(input.pageKey) ?? new Map<string, ObservedApiEndpoint>();
    this.recordInto(pageMap, input);
    this.pageEndpoints.set(input.pageKey, pageMap);
  }

  private recordInto(
    map: Map<string, ObservedApiEndpoint>,
    input: {
      route: string;
      method: string;
      status: number;
      failure?: string;
      sample?: ObservedApiRequestSample;
    }
  ): void {
    const current = map.get(input.route) ?? {
      route: input.route,
      methods: [],
      statuses: [],
      failures: [],
      samples: [],
      responses: [],
    };

    current.methods = uniqueSorted([...current.methods, input.method.toUpperCase()]);
    current.statuses = uniqueNumbers([...current.statuses, input.status]);
    if (input.failure) {
      current.failures = uniqueSorted([...current.failures, input.failure]);
    }
    if (input.sample) {
      current.samples = appendSample(current.samples ?? [], input.sample);
    }

    map.set(input.route, current);
  }
}

function normalizeRoute(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
}

function normalizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search}`;
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

async function readHeaders(
  value:
    | {
        headers?: () => Promise<Record<string, string>> | Record<string, string>;
        allHeaders?: () => Promise<Record<string, string>>;
      }
    | undefined
): Promise<Record<string, string>> {
  if (!value) {
    return {};
  }

  if (typeof value.allHeaders === "function") {
    return normalizeHeaderNames(await value.allHeaders());
  }
  if (typeof value.headers === "function") {
    return normalizeHeaderNames(await Promise.resolve(value.headers()));
  }

  return {};
}

function readHeadersSync(
  value:
    | {
        headers?: () => Promise<Record<string, string>> | Record<string, string>;
      }
    | undefined
): Record<string, string> {
  if (!value || typeof value.headers !== "function") {
    return {};
  }

  const result = value.headers();
  if (result && typeof (result as PromiseLike<Record<string, string>>).then === "function") {
    return {};
  }

  return normalizeHeaderNames(result as Record<string, string>);
}

async function readResponseText(response: { text?: () => Promise<string> }): Promise<string> {
  if (typeof response.text !== "function") {
    return "";
  }

  try {
    return await response.text();
  } catch {
    return "";
  }
}

function normalizeHeaderNames(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function parseRequestData(raw: string | null | undefined, contentType?: string): unknown {
  if (!raw) {
    return undefined;
  }

  return parseBody(contentType, raw);
}

function parseResponseBody(contentType: string | undefined, text: string): unknown {
  if (!text) {
    return undefined;
  }

  return parseBody(contentType, text);
}

function parseBody(contentType: string | undefined, text: string): unknown {
  if (contentType?.includes("json")) {
    try {
      return redactSensitiveValue(JSON.parse(text));
    } catch {
      return truncateString(text);
    }
  }

  return truncateString(text);
}

function appendSample(
  samples: ObservedApiRequestSample[],
  sample: ObservedApiRequestSample
): ObservedApiRequestSample[] {
  const next = [...samples, sample];
  if (next.length <= MAX_SAMPLES_PER_ENDPOINT) {
    return next;
  }

  return next.slice(next.length - MAX_SAMPLES_PER_ENDPOINT);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
