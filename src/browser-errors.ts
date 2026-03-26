import type { Stagehand } from "@browserbasehq/stagehand";
import type {
  RawFinding,
  Evidence,
  BrowserConsoleError,
  BrowserNetworkError,
  BrowserPageError,
} from "./types.js";
import { shortId, TRUNCATE_GROUP_KEY, TRUNCATE_SUMMARY, TRUNCATE_TITLE } from "./constants.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface BrowserErrorCollectorOptions {
  captureConsole: boolean;
  captureNetwork: boolean;
  networkErrorMinStatus: number;
}

/** Auto-captures console errors, uncaught exceptions, and network failures from browser pages. */
export class BrowserErrorCollector {
  private consoleErrors: BrowserConsoleError[] = [];
  private networkErrors: BrowserNetworkError[] = [];
  private pageErrors: BrowserPageError[] = [];
  private options: BrowserErrorCollectorOptions;
  private teardownFns: Array<() => void> = [];

  constructor(options: BrowserErrorCollectorOptions) {
    this.options = options;
  }

  /** Attach event listeners to a page. Safe to call for multiple pages. */
  attach(page: StagehandPage): void {
    // Stagehand's Page type only exposes a subset of Playwright events,
    const p = page as any;

    if (this.options.captureConsole) {
      const onConsole = (msg: { type: () => string; text: () => string }) => {
        const type = msg.type();
        if (type === "error" || type === "warning") {
          this.consoleErrors.push({
            level: type as "error" | "warning",
            text: msg.text(),
            url: page.url(),
            timestamp: new Date().toISOString(),
          });
        }
      };
      p.on("console", onConsole);
      this.teardownFns.push(() => p.off("console", onConsole));

      const onPageError = (error: Error) => {
        this.pageErrors.push({
          message: error.message,
          url: page.url(),
          timestamp: new Date().toISOString(),
        });
      };
      p.on("pageerror", onPageError);
      this.teardownFns.push(() => p.off("pageerror", onPageError));
    }

    if (this.options.captureNetwork) {
      const minStatus = this.options.networkErrorMinStatus;
      const onResponse = (response: { status: () => number; url: () => string; statusText: () => string; request: () => { method: () => string } }) => {
        const status = response.status();
        if (status >= minStatus) {
          this.networkErrors.push({
            method: response.request().method(),
            url: response.url(),
            status,
            statusText: response.statusText(),
            timestamp: new Date().toISOString(),
          });
        }
      };
      p.on("response", onResponse);
      this.teardownFns.push(() => p.off("response", onResponse));

      const onRequestFailed = (request: { url: () => string; method: () => string; failure: () => { errorText: string } | null }) => {
        const failure = request.failure();
        if (failure) {
          this.networkErrors.push({
            method: request.method(),
            url: request.url(),
            status: 0,
            statusText: failure.errorText,
            timestamp: new Date().toISOString(),
          });
        }
      };
      p.on("requestfailed", onRequestFailed);
      this.teardownFns.push(() => p.off("requestfailed", onRequestFailed));
    }
  }

    detach(): void {
    for (const fn of this.teardownFns) fn();
    this.teardownFns = [];
  }

    /** Drain captured errors into findings + evidence, clearing internal buffers. */
  flush(): { findings: RawFinding[]; evidence: Evidence[] } {
    const findings: RawFinding[] = [];
    const evidence: Evidence[] = [];

    const emit = (
      evidenceType: Evidence["type"],
      summary: string,
      timestamp: string,
      finding: Omit<RawFinding, "evidenceIds">
    ) => {
      const evidenceId = `ev-${shortId()}`;
      evidence.push({ id: evidenceId, type: evidenceType, summary, timestamp, relatedFindingIds: [] });
      findings.push({ ...finding, evidenceIds: [evidenceId] });
    };

    // Group console errors by message to avoid duplicate findings
    const consoleMsgs = new Map<string, BrowserConsoleError[]>();
    for (const err of this.consoleErrors) {
      const key = err.text.slice(0, TRUNCATE_GROUP_KEY);
      const group = consoleMsgs.get(key) ?? [];
      group.push(err);
      consoleMsgs.set(key, group);
    }

    for (const [msg, errors] of consoleMsgs) {
      const first = errors[0];
      emit("console-error", `${first.level}: ${msg.slice(0, TRUNCATE_SUMMARY)}`, first.timestamp, {
        category: "Bug",
        severity: first.level === "error" ? "Major" : "Minor",
        title: `Browser console ${first.level}: ${msg.slice(0, TRUNCATE_TITLE)}`,
        stepsToReproduce: [`Navigate to ${first.url}`],
        expected: "No console errors",
        actual: `${errors.length} occurrence(s): ${msg.slice(0, TRUNCATE_GROUP_KEY)}`,
      });
    }

    // Page errors (uncaught exceptions)
    for (const err of this.pageErrors) {
      emit("console-error", `Uncaught: ${err.message.slice(0, TRUNCATE_SUMMARY)}`, err.timestamp, {
        category: "Bug",
        severity: "Critical",
        title: `Uncaught exception: ${err.message.slice(0, TRUNCATE_TITLE)}`,
        stepsToReproduce: [`Navigate to ${err.url}`],
        expected: "No uncaught exceptions",
        actual: err.message,
      });
    }

    // Group network errors by URL+status
    const networkMsgs = new Map<string, BrowserNetworkError[]>();
    for (const err of this.networkErrors) {
      const key = `${err.method} ${err.url} ${err.status}`;
      const group = networkMsgs.get(key) ?? [];
      group.push(err);
      networkMsgs.set(key, group);
    }

    for (const [, errors] of networkMsgs) {
      const first = errors[0];
      const statusLabel = first.status === 0 ? "failed" : `${first.status}`;
      let pathname: string;
      try {
        pathname = new URL(first.url).pathname;
      } catch {
        pathname = first.url;
      }
      emit("network-error", `${first.method} ${first.url} → ${statusLabel}`, first.timestamp, {
        category: "Bug",
        severity: first.status >= 500 ? "Major" : "Minor",
        title: `Network ${statusLabel}: ${first.method} ${pathname}`,
        stepsToReproduce: [`Request: ${first.method} ${first.url}`],
        expected: "Successful HTTP response (2xx/3xx)",
        actual: `${errors.length} occurrence(s): ${first.status} ${first.statusText}`,
      });
    }

    // Clear captured data
    this.consoleErrors = [];
    this.networkErrors = [];
    this.pageErrors = [];

    return { findings, evidence };
  }

    get pendingCount(): number {
    return (
      this.consoleErrors.length +
      this.networkErrors.length +
      this.pageErrors.length
    );
  }
}
