import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  getConfigFileContext,
  normalizeConfigPaths,
  resolveResumeDir,
} from "./config-paths.js";

describe("getConfigFileContext", () => {
  it("derives an absolute config path and config directory", () => {
    const context = getConfigFileContext("./configs/dramaturge.config.json");

    expect(context).toEqual({
      configPath: resolve("./configs/dramaturge.config.json"),
      configDir: resolve("./configs"),
    });
  });
});

describe("normalizeConfigPaths", () => {
  it("resolves file-system config relative to the config file", () => {
    const configPath = resolve("C:/tmp/dramaturge/configs/dramaturge.config.json");
    const normalized = normalizeConfigPaths(
      {
        targetUrl: "https://example.com/app",
        appDescription: "Standalone app",
        auth: {
          type: "interactive",
          loginUrl: "/login",
          successIndicator: "selector:[data-testid='app-shell']",
          stateFile: "./state/user.json",
          manualTimeoutSeconds: 120,
        },
        models: {
          planner: "anthropic/claude-sonnet-4-6",
          worker: "anthropic/claude-haiku-4-5",
          agentMode: "cua",
        },
        exploration: {
          maxAreasToExplore: 10,
          stepsPerArea: 40,
          totalTimeout: 900,
        },
        output: {
          dir: "./reports",
          format: "markdown",
          screenshots: true,
        },
        memory: {
          enabled: true,
          dir: "./.dramaturge",
          warmStart: true,
        },
        visualRegression: {
          enabled: true,
          baselineDir: "./.dramaturge/visual-baselines",
          diffPixelRatioThreshold: 0.01,
          includeAA: false,
          fullPage: true,
          maskSelectors: ["[data-testid='clock']"],
        },
        apiTesting: {
          enabled: false,
          maxEndpointsPerNode: 4,
          maxProbeCasesPerEndpoint: 6,
          unauthenticatedProbes: true,
          allowMutatingProbes: false,
        },
        adversarial: {
          enabled: false,
          maxSequencesPerNode: 3,
          safeMode: true,
          includeAuthzProbes: false,
          includeConcurrencyProbes: false,
        },
        judge: {
          enabled: true,
          requestTimeoutMs: 15000,
        },
        budget: {
          globalTimeLimitSeconds: 900,
          maxStepsPerTask: 40,
          maxFrontierSize: 200,
          maxStateNodes: 50,
          stagnationThreshold: 8,
        },
        autoCapture: {
          consoleErrors: true,
          networkErrors: true,
          networkErrorMinStatus: 400,
        },
        browser: {
          headless: false,
        },
        llm: {
          requestTimeoutMs: 30000,
        },
        concurrency: {
          workers: 1,
        },
        checkpoint: {
          intervalTasks: 5,
        },
        repoContext: {
          root: "../host-app",
          framework: "nextjs",
          hintsFile: "./hints/dramaturge.hints.jsonc",
          specFile: "./specs/dramaturge.openapi.json",
        },
        bootstrap: {
          command: "pnpm dev",
          cwd: "../host-app",
          timeoutSeconds: 120,
        },
        policy: {
          expectedResponses: [],
          ignoredConsolePatterns: [],
        },
      },
      getConfigFileContext(configPath)
    );

    expect(normalized.auth).toMatchObject({
      type: "interactive",
      stateFile: resolve("C:/tmp/dramaturge/configs/state/user.json"),
    });
    expect(normalized.output.dir).toBe(resolve("C:/tmp/dramaturge/configs/reports"));
    expect(normalized.memory).toMatchObject({
      enabled: true,
      dir: resolve("C:/tmp/dramaturge/configs/.dramaturge"),
    });
    expect(normalized.visualRegression).toMatchObject({
      enabled: true,
      baselineDir: resolve("C:/tmp/dramaturge/configs/.dramaturge/visual-baselines"),
      maskSelectors: ["[data-testid='clock']"],
    });
    expect(normalized.repoContext).toMatchObject({
      root: resolve("C:/tmp/dramaturge/host-app"),
      hintsFile: resolve("C:/tmp/dramaturge/host-app/hints/dramaturge.hints.jsonc"),
      specFile: resolve("C:/tmp/dramaturge/host-app/specs/dramaturge.openapi.json"),
    });
    expect(normalized.bootstrap).toMatchObject({
      cwd: resolve("C:/tmp/dramaturge/host-app"),
    });
    expect(normalized._meta).toEqual({
      configPath,
      configDir: resolve("C:/tmp/dramaturge/configs"),
    });
  });
});

describe("resolveResumeDir", () => {
  it("resolves relative resume directories from the config directory", () => {
    expect(
      resolveResumeDir("./runs/last", {
        _meta: { configDir: resolve("C:/tmp/dramaturge/configs") },
      })
    ).toBe(resolve("C:/tmp/dramaturge/configs/runs/last"));
  });

  it("preserves absolute resume directories", () => {
    const absolutePath = resolve("C:/tmp/dramaturge/reports/run-1");
    expect(
      resolveResumeDir(absolutePath, {
        _meta: { configDir: resolve("C:/tmp/dramaturge/configs") },
      })
    ).toBe(absolutePath);
  });

  it("returns undefined when no resume dir is provided", () => {
    expect(
      resolveResumeDir(undefined, {
        _meta: { configDir: resolve("C:/tmp/dramaturge/configs") },
      })
    ).toBeUndefined();
  });
});
