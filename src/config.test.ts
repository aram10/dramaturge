import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { parseJsoncObject } from "./utils/jsonc.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dramaturge-config-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("parseJsoncObject", () => {
  it("preserves https URLs while stripping comments", () => {
    const parsed = parseJsoncObject(`{
      // comment
      "targetUrl": "https://example.com/app",
      "auth": { "loginUrl": "/login" }
    }`);

    expect(parsed).toMatchObject({
      targetUrl: "https://example.com/app",
      auth: { loginUrl: "/login" },
    });
  });

  it("supports line and block comments without touching quoted strings", () => {
    const parsed = parseJsoncObject(`{
      "note": "keep // inside string",
      /* block comment */
      "value": "ok"
    }`);

    expect(parsed).toMatchObject({
      note: "keep // inside string",
      value: "ok",
    });
  });
});

describe("loadConfig", () => {
  it("loads JSONC config files without corrupting https URLs", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        // URL comments should not break strings
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": {
          "type": "none"
        }
      }`,
      "utf-8"
    );

    const config = loadConfig(configPath);

    expect(config.targetUrl).toBe("https://example.com/app");
    expect(config.appDescription).toBe("Test app");
    expect(config.auth).toMatchObject({ type: "none" });
  });

  it("accepts repo-aware mode and bootstrap settings", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": {
          "type": "none"
        },
        "repoContext": {
          "root": "../..",
          "framework": "nextjs",
          "hintsFile": "./dramaturge.hints.jsonc",
          "specFile": "./dramaturge.openapi.json"
        },
        "bootstrap": {
          "command": "pnpm dev",
          "cwd": "..",
          "readyUrl": "https://example.com/health",
          "readyIndicator": "[data-testid='app-shell']",
          "timeoutSeconds": 90
        }
      }`,
      "utf-8"
    );

    const config = loadConfig(configPath);

    expect(config.repoContext).toMatchObject({
      root: resolve(dir, "../.."),
      framework: "nextjs",
      hintsFile: resolve(dir, "../..", "dramaturge.hints.jsonc"),
      specFile: resolve(dir, "../..", "dramaturge.openapi.json"),
    });
    expect(config.bootstrap).toMatchObject({
      command: "pnpm dev",
      cwd: resolve(dir, ".."),
      readyUrl: "https://example.com/health",
      readyIndicator: "[data-testid='app-shell']",
      timeoutSeconds: 90,
    });
  });

  it("accepts explicit policy controls", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": { "type": "none" },
        "policy": {
          "expectedResponses": [
            {
              "method": "GET",
              "pathPrefix": "/api/manage/knowledge-bases",
              "statuses": [401, 403]
            }
          ],
          "ignoredConsolePatterns": ["ResizeObserver loop"]
        }
      }`,
      "utf-8"
    );

    const config = loadConfig(configPath);

    expect(config.policy).toMatchObject({
      expectedResponses: [
        {
          method: "GET",
          pathPrefix: "/api/manage/knowledge-bases",
          statuses: [401, 403],
        },
      ],
      ignoredConsolePatterns: ["ResizeObserver loop"],
    });
    expect(config.apiTesting).toMatchObject({
      enabled: false,
      maxEndpointsPerNode: 4,
      maxProbeCasesPerEndpoint: 6,
      unauthenticatedProbes: true,
      allowMutatingProbes: false,
    });
    expect(config.adversarial).toMatchObject({
      enabled: false,
      maxSequencesPerNode: 3,
      safeMode: true,
      includeAuthzProbes: false,
      includeConcurrencyProbes: false,
    });
    expect(config.judge).toMatchObject({
      enabled: true,
      requestTimeoutMs: 15000,
    });
  });

  it("accepts deterministic form auth config", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": {
          "type": "form",
          "loginUrl": "/login",
          "fields": [
            { "selector": "input[name='email']", "value": "user@example.com" },
            { "selector": "input[name='password']", "value": "\${TEST_PASSWORD}", "secret": true }
          ],
          "submit": { "selector": "button[type='submit']" },
          "successIndicator": "selector:[data-testid='user-nav-button']"
        }
      }`,
      "utf-8"
    );

    process.env.TEST_PASSWORD = "super-secret";
    const config = loadConfig(configPath);

    expect(config.auth).toMatchObject({
      type: "form",
      loginUrl: "/login",
      fields: [
        { selector: "input[name='email']", value: "user@example.com", secret: false },
        { selector: "input[name='password']", value: "super-secret", secret: true },
      ],
      submit: { selector: "button[type='submit']" },
      successIndicator: "selector:[data-testid='user-nav-button']",
    });
  });

  it("accepts scripted oauth redirect auth config", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": {
          "type": "oauth-redirect",
          "loginUrl": "/login",
          "steps": [
            { "type": "click", "selector": "button[data-provider='microsoft']" },
            { "type": "fill", "selector": "input[type='email']", "value": "user@example.com" },
            { "type": "wait-for-selector", "selector": "input[type='password']" }
          ],
          "successIndicator": "selector:[data-testid='user-nav-button']"
        }
      }`,
      "utf-8"
    );

    const config = loadConfig(configPath);

    expect(config.auth).toMatchObject({
      type: "oauth-redirect",
      loginUrl: "/login",
      steps: [
        { type: "click", selector: "button[data-provider='microsoft']" },
        { type: "fill", selector: "input[type='email']", value: "user@example.com", secret: false },
        { type: "wait-for-selector", selector: "input[type='password']" },
      ],
      successIndicator: "selector:[data-testid='user-nav-button']",
    });
  });

  it("rejects legacy form auth configs that pass credentials by field name", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": {
          "type": "form",
          "loginUrl": "/login",
          "credentials": {
            "email": "user@example.com",
            "password": "super-secret"
          },
          "successIndicator": "selector:[data-testid='user-nav-button']"
        }
      }`,
      "utf-8"
    );

    expect(() => loadConfig(configPath)).toThrow();
  });

  it("rejects legacy oauth redirect configs that pass raw credentials", () => {
    const dir = createTempDir();
    const configPath = join(dir, "dramaturge.config.json");
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Test app",
        "auth": {
          "type": "oauth-redirect",
          "loginUrl": "/login",
          "credentials": {
            "email": "user@example.com",
            "password": "super-secret"
          },
          "successIndicator": "selector:[data-testid='user-nav-button']"
        }
      }`,
      "utf-8"
    );

    expect(() => loadConfig(configPath)).toThrow();
  });

  it("resolves filesystem paths relative to the config file", () => {
    const dir = createTempDir();
    const configsDir = join(dir, "configs");
    const configPath = join(configsDir, "dramaturge.config.json");
    mkdirSync(configsDir, { recursive: true });
    writeFileSync(
      configPath,
      `{
        "targetUrl": "https://example.com/app",
        "appDescription": "Standalone app",
        "auth": {
          "type": "interactive",
          "loginUrl": "/login",
          "successIndicator": "selector:[data-testid='user-nav-button']",
          "stateFile": "./state/user.json"
        },
        "output": {
          "dir": "./reports"
        },
        "memory": {
          "enabled": true,
          "dir": "./.dramaturge",
          "warmStart": true
        },
        "visualRegression": {
          "enabled": true,
          "baselineDir": "./.dramaturge/visual-baselines",
          "maskSelectors": ["[data-testid='clock']"]
        },
        "repoContext": {
          "root": "../host",
          "framework": "nextjs",
          "hintsFile": "./hints/dramaturge.hints.jsonc",
          "specFile": "./specs/dramaturge.openapi.json"
        },
        "bootstrap": {
          "command": "pnpm dev",
          "cwd": "../host"
        }
      }`,
      "utf-8"
    );

    const config = loadConfig(configPath);

    expect(config.auth).toMatchObject({
      type: "interactive",
      stateFile: resolve(configsDir, "state/user.json"),
    });
    expect(config.output.dir).toBe(resolve(configsDir, "reports"));
    expect(config.memory).toMatchObject({
      enabled: true,
      dir: resolve(configsDir, ".dramaturge"),
      warmStart: true,
    });
    expect(config.visualRegression).toMatchObject({
      enabled: true,
      baselineDir: resolve(configsDir, ".dramaturge/visual-baselines"),
      maskSelectors: ["[data-testid='clock']"],
    });
    expect(config.repoContext).toMatchObject({
      root: resolve(configsDir, "../host"),
      hintsFile: resolve(configsDir, "../host", "hints/dramaturge.hints.jsonc"),
      specFile: resolve(configsDir, "../host", "specs/dramaturge.openapi.json"),
    });
    expect(config.bootstrap).toMatchObject({
      cwd: resolve(configsDir, "../host"),
    });
    expect(config._meta).toEqual({
      configPath: resolve(configPath),
      configDir: resolve(configsDir),
    });
  });

});
