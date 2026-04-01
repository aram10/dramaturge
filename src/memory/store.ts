import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DramaturgeConfig } from "../config.js";
import type { AreaResult, RawFinding, RunMemoryMeta } from "../types.js";
import type { StateGraph } from "../graph/state-graph.js";
import { collectFindings, buildFindingGroupKey } from "../report/collector.js";
import type {
  ObservedApiEndpoint,
  ObservedApiRequestSample,
} from "../network/traffic-observer.js";
import type {
  FlakyPageInput,
  HistoricalFlakyPageRecord,
  HistoricalApiEndpointRecord,
  MemoryRouteMatchInput,
  MemorySnapshot,
  NavigationMemorySnapshot,
  PlannerMemorySignals,
  WorkerHistoryContext,
} from "./types.js";

const STORE_FILE = "memory.json";
const CURRENT_MEMORY_VERSION = 1 as const;

function createEmptySnapshot(): MemorySnapshot {
  return {
    version: CURRENT_MEMORY_VERSION,
    updatedAt: new Date(0).toISOString(),
    findingHistory: {},
    flakyPages: [],
    authHints: {
      successfulLoginRoutes: [],
    },
    observedApiCatalog: [],
  };
}

function normalizeRoute(urlOrPath?: string): string | undefined {
  if (!urlOrPath) {
    return undefined;
  }
  try {
    return new URL(urlOrPath).pathname;
  } catch {
    return urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  }
}

function normalizeOrigin(urlOrPath?: string): string | undefined {
  if (!urlOrPath) {
    return undefined;
  }
  try {
    return new URL(urlOrPath).origin;
  } catch {
    return undefined;
  }
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueSortedStrings(values: Array<string | undefined>): string[] {
  return uniqueStrings(values).sort();
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function cloneObservedApiSample(
  sample: ObservedApiRequestSample
): ObservedApiRequestSample {
  return {
    method: sample.method,
    status: sample.status,
    url: sample.url,
    ...(sample.headers ? { headers: { ...sample.headers } } : {}),
    ...(sample.data !== undefined ? { data: sample.data } : {}),
    ...(sample.responseBody !== undefined
      ? { responseBody: sample.responseBody }
      : {}),
    ...(sample.failure ? { failure: sample.failure } : {}),
  };
}

function cloneObservedEndpoint(
  endpoint: ObservedApiEndpoint
): ObservedApiEndpoint {
  const samples = endpoint.samples?.map((sample) => cloneObservedApiSample(sample)) ?? [];
  const responses =
    endpoint.responses?.map((response) => ({
      status: response.status,
      ...(response.body !== undefined ? { body: response.body } : {}),
    })) ?? [];

  return {
    route: endpoint.route,
    methods: [...endpoint.methods],
    statuses: [...endpoint.statuses],
    failures: [...endpoint.failures],
    ...(samples.length > 0 ? { samples } : {}),
    ...(responses.length > 0 ? { responses } : {}),
  };
}

function uniqueObservedSamples(
  samples: ObservedApiRequestSample[]
): ObservedApiRequestSample[] {
  const seen = new Set<string>();
  const results: ObservedApiRequestSample[] = [];

  for (const sample of samples) {
    const signature = JSON.stringify([
      sample.method,
      sample.status,
      sample.url,
      sample.failure,
      sample.headers ?? null,
      sample.data ?? null,
      sample.responseBody ?? null,
    ]);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    results.push(cloneObservedApiSample(sample));
  }

  return results;
}

function uniqueObservedResponses(
  responses: NonNullable<ObservedApiEndpoint["responses"]>
): NonNullable<ObservedApiEndpoint["responses"]> {
  const seen = new Set<string>();
  const results: NonNullable<ObservedApiEndpoint["responses"]> = [];

  for (const response of responses) {
    const signature = JSON.stringify([response.status, response.body ?? null]);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    results.push({
      status: response.status,
      ...(response.body !== undefined ? { body: response.body } : {}),
    });
  }

  return results;
}

function routeTokens(urlOrPath?: string): string[] {
  const route = normalizeRoute(urlOrPath);
  if (!route) {
    return [];
  }

  return route
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
    .filter((segment) => !segment.startsWith(":") && !/^\d+$/.test(segment));
}

function matchesRoute(
  input: MemoryRouteMatchInput,
  candidateRoute?: string,
  candidateFingerprintHash?: string
): boolean {
  const route = normalizeRoute(input.url) ?? input.fingerprint?.normalizedPath;
  if (candidateFingerprintHash && input.fingerprint?.hash === candidateFingerprintHash) {
    return true;
  }
  if (!candidateRoute) {
    return false;
  }
  const normalizedCandidate = normalizeRoute(candidateRoute);
  if (!normalizedCandidate || !route) {
    return false;
  }
  return route === normalizedCandidate;
}

export function buildFindingSignature(finding: Pick<RawFinding, "category" | "severity" | "title" | "expected" | "actual">): string {
  return buildFindingGroupKey(finding);
}

export class MemoryStore {
  private snapshot?: MemorySnapshot;

  constructor(private dir: string) {}

  getSnapshot(): MemorySnapshot {
    if (!this.snapshot) {
      const path = this.storePath();
      if (!existsSync(path)) {
        this.snapshot = createEmptySnapshot();
      } else {
        let raw: MemorySnapshot;
        try {
          raw = JSON.parse(readFileSync(path, "utf-8")) as MemorySnapshot;
        } catch {
          throw new Error(`Failed to parse memory store JSON: ${path}`);
        }
        if (raw.version !== CURRENT_MEMORY_VERSION) {
          throw new Error(`Unsupported memory snapshot version: ${raw.version}`);
        }
        this.snapshot = {
          ...createEmptySnapshot(),
          ...raw,
          authHints: {
            successfulLoginRoutes: raw.authHints?.successfulLoginRoutes ?? [],
          },
          findingHistory: raw.findingHistory ?? {},
          flakyPages: raw.flakyPages ?? [],
          observedApiCatalog: (raw.observedApiCatalog ?? []).map((record) => ({
            ...cloneObservedEndpoint(record),
            firstSeenAt: record.firstSeenAt,
            lastSeenAt: record.lastSeenAt,
            runCount: record.runCount,
          })),
        };
      }
    }
    return this.snapshot;
  }

  recordRunFindings(runAt: string, areaResults: AreaResult[]): void {
    const snapshot = this.getSnapshot();
    const findings = collectFindings(areaResults);

    for (const finding of findings) {
      const signature = buildFindingSignature(finding);
      const existing = snapshot.findingHistory[signature];
      const recentRoutes = uniqueStrings([
        ...(existing?.recentRoutes ?? []),
        ...finding.occurrences.map((occurrence) => occurrence.route),
        finding.meta?.repro?.route,
      ]).slice(-8);

      snapshot.findingHistory[signature] = {
        signature,
        title: finding.title,
        category: finding.category,
        severity: finding.severity,
        confidence: finding.meta?.confidence ?? existing?.confidence,
        firstSeenAt: existing?.firstSeenAt ?? runAt,
        lastSeenAt: runAt,
        runCount: (existing?.runCount ?? 0) + 1,
        occurrenceCount: (existing?.occurrenceCount ?? 0) + finding.occurrenceCount,
        recentRoutes,
        dismissedAt: existing?.dismissedAt,
        dismissalReason: existing?.dismissalReason,
        suppressed: existing?.suppressed ?? false,
      };
    }

    this.persist(snapshot);
  }

  markFindingSuppressed(signature: string, reason: string, dismissedAt = new Date().toISOString()): void {
    const snapshot = this.getSnapshot();
    const existing = snapshot.findingHistory[signature];
    if (!existing) {
      throw new Error(`Cannot suppress unknown finding signature: ${signature}`);
    }

    snapshot.findingHistory[signature] = {
      ...existing,
      suppressed: true,
      dismissedAt,
      dismissalReason: reason,
    };
    this.persist(snapshot);
  }

  recordFlakyPage(input: FlakyPageInput): void {
    const snapshot = this.getSnapshot();
    const route = normalizeRoute(input.route);
    const key = `${input.fingerprintHash ?? "no-fingerprint"}::${route ?? "no-route"}::${input.note}`;
    const existing = snapshot.flakyPages.find((record) => record.key === key);
    const now = new Date().toISOString();

    if (existing) {
      existing.lastSeenAt = now;
      existing.count += 1;
      this.persist(snapshot);
      return;
    }

    snapshot.flakyPages.push({
      key,
      route,
      fingerprintHash: input.fingerprintHash,
      note: input.note,
      source: input.source ?? "manual",
      firstSeenAt: now,
      lastSeenAt: now,
      count: 1,
    });
    this.persist(snapshot);
  }

  recordNavigationSnapshot(targetUrl: string, graph: StateGraph): void {
    const snapshot = this.getSnapshot();
    snapshot.navigation = {
      targetOrigin: normalizeOrigin(targetUrl) ?? targetUrl,
      savedAt: new Date().toISOString(),
      nodes: graph.getAllNodes(),
      edges: graph.getAllEdges(),
    };
    this.persist(snapshot);
  }

  recordObservedApiTraffic(runAt: string, endpoints: ObservedApiEndpoint[]): void {
    if (endpoints.length === 0) {
      return;
    }

    const snapshot = this.getSnapshot();

    for (const endpoint of endpoints) {
      const existing = snapshot.observedApiCatalog.find(
        (record) => record.route === endpoint.route
      );

      if (existing) {
        existing.methods = uniqueSortedStrings([...existing.methods, ...endpoint.methods]);
        existing.statuses = uniqueNumbers([...existing.statuses, ...endpoint.statuses]);
        existing.failures = uniqueSortedStrings([
          ...existing.failures,
          ...endpoint.failures,
        ]);
        const mergedSamples = uniqueObservedSamples([
          ...(existing.samples ?? []),
          ...(endpoint.samples ?? []),
        ]);
        if (mergedSamples.length > 0) {
          existing.samples = mergedSamples;
        } else {
          delete existing.samples;
        }
        const mergedResponses = uniqueObservedResponses([
          ...(existing.responses ?? []),
          ...(endpoint.responses ?? []),
        ]);
        if (mergedResponses.length > 0) {
          existing.responses = mergedResponses;
        } else {
          delete existing.responses;
        }
        existing.lastSeenAt = runAt;
        existing.runCount += 1;
        continue;
      }

      snapshot.observedApiCatalog.push({
        route: endpoint.route,
        methods: uniqueSortedStrings(endpoint.methods),
        statuses: uniqueNumbers(endpoint.statuses),
        failures: uniqueSortedStrings(endpoint.failures),
        ...(endpoint.samples
          ? { samples: uniqueObservedSamples(endpoint.samples) }
          : {}),
        ...(endpoint.responses
          ? { responses: uniqueObservedResponses(endpoint.responses) }
          : {}),
        firstSeenAt: runAt,
        lastSeenAt: runAt,
        runCount: 1,
      });
    }

    this.persist(snapshot);
  }

  rememberAuthHint(loginUrl: string): void {
    const snapshot = this.getSnapshot();
    const loginRoute = normalizeRoute(loginUrl);
    if (!loginRoute) return;
    snapshot.authHints.successfulLoginRoutes = uniqueStrings([
      ...snapshot.authHints.successfulLoginRoutes,
      loginRoute,
    ]);
    this.persist(snapshot);
  }

  rememberAuthFromConfig(config: DramaturgeConfig): void {
    switch (config.auth.type) {
      case "form":
      case "oauth-redirect":
      case "interactive":
        this.rememberAuthHint(config.auth.loginUrl);
        break;
      default:
        break;
    }
  }

  getNavigationSnapshot(targetUrl: string): NavigationMemorySnapshot | undefined {
    const snapshot = this.getSnapshot();
    if (!snapshot.navigation) {
      return undefined;
    }
    const expectedOrigin = normalizeOrigin(targetUrl) ?? targetUrl;
    return snapshot.navigation.targetOrigin === expectedOrigin
      ? snapshot.navigation
      : undefined;
  }

  getWorkerContext(input: MemoryRouteMatchInput): WorkerHistoryContext {
    const snapshot = this.getSnapshot();
    const matchingFindings = Object.values(snapshot.findingHistory).filter(
      (record) =>
        (record.suppressed || record.dismissedAt) &&
        (record.recentRoutes.length === 0 ||
          record.recentRoutes.some((route) => matchesRoute(input, route)))
    );
    const matchingFlakyPages = snapshot.flakyPages.filter((record) =>
      matchesRoute(input, record.route, record.fingerprintHash)
    );
    const navigationHints = this.describeNavigationHints(input, snapshot.navigation);
    const apiHints = this.describeApiHints(input, snapshot.observedApiCatalog);

    return {
      suppressedFindings: matchingFindings.map((record) => record.title),
      flakyPageNotes: matchingFlakyPages.map((record) => record.note),
      navigationHints,
      authHints: [...snapshot.authHints.successfulLoginRoutes],
      apiHints,
    };
  }

  getPlannerSignals(input: MemoryRouteMatchInput): PlannerMemorySignals {
    const workerContext = this.getWorkerContext(input);
    return {
      hasSuppressedFindings: workerContext.suppressedFindings.length > 0,
      hasFlakyPageNotes: workerContext.flakyPageNotes.length > 0,
      hasNavigationHints:
        workerContext.navigationHints.length > 0 || workerContext.authHints.length > 0,
    };
  }

  getSummary(warmStartApplied: boolean, restoredStateCount = 0): RunMemoryMeta {
    const snapshot = this.getSnapshot();
    const navigation = snapshot.navigation;

    return {
      enabled: true,
      warmStartApplied,
      restoredStateCount,
      knownFindingCount: Object.keys(snapshot.findingHistory).length,
      suppressedFindingCount: Object.values(snapshot.findingHistory).filter(
        (record) => record.suppressed || record.dismissedAt
      ).length,
      flakyPageCount: snapshot.flakyPages.length,
      visualBaselineCount: navigation?.nodes.length ?? 0,
    };
  }

  private describeNavigationHints(
    input: MemoryRouteMatchInput,
    navigation?: NavigationMemorySnapshot
  ): string[] {
    if (!navigation) {
      return [];
    }

    const matchedNode = navigation.nodes.find((node) => matchesRoute(input, node.url, node.fingerprint.hash));
    if (!matchedNode) {
      return [];
    }

    const hints: string[] = [];
    if (matchedNode.navigationHint?.actionDescription) {
      hints.push(`Previously reached via: ${matchedNode.navigationHint.actionDescription}`);
    } else if (matchedNode.navigationHint?.selector) {
      hints.push(`Previously reached via selector: ${matchedNode.navigationHint.selector}`);
    }

    for (const edge of navigation.edges.filter((item) => item.fromNodeId === matchedNode.id)) {
      const targetNode = navigation.nodes.find((node) => node.id === edge.toNodeId);
      const destination = normalizeRoute(targetNode?.url) ?? targetNode?.fingerprint.normalizedPath ?? edge.toNodeId;
      hints.push(`Known transition: ${edge.actionLabel} -> ${destination}`);
    }

    return uniqueStrings(hints);
  }

  private describeApiHints(
    input: MemoryRouteMatchInput,
    catalog: HistoricalApiEndpointRecord[]
  ): ObservedApiEndpoint[] {
    if (catalog.length === 0) {
      return [];
    }

    const inputTokens = new Set(routeTokens(input.url ?? input.fingerprint?.normalizedPath));
    const ranked = catalog
      .map((record) => ({
        record,
        score: routeTokens(record.route).filter((token) => inputTokens.has(token)).length,
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.record.lastSeenAt.localeCompare(left.record.lastSeenAt);
      });

    return ranked.slice(0, 4).map(({ record }) => ({
      route: record.route,
      methods: [...record.methods],
      statuses: [...record.statuses],
      failures: [...record.failures],
      ...(record.samples
        ? {
            samples: record.samples.map((sample) =>
              cloneObservedApiSample(sample)
            ),
          }
        : {}),
      ...(record.responses
        ? {
            responses: record.responses.map((response) => ({
              status: response.status,
              ...(response.body !== undefined ? { body: response.body } : {}),
            })),
          }
        : {}),
    }));
  }

  private persist(snapshot: MemorySnapshot): void {
    snapshot.updatedAt = new Date().toISOString();
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.storePath(), JSON.stringify(snapshot, null, 2), "utf-8");
    this.snapshot = snapshot;
  }

  private storePath(): string {
    return join(this.dir, STORE_FILE);
  }
}
