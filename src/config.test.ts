import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { parseJsoncObject } from "./utils/jsonc.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "webprobe-config-test-"));
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
    const configPath = join(dir, "webprobe.config.json");
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
    const configPath = join(dir, "webprobe.config.json");
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
          "hintsFile": "./webprobe.hints.jsonc"
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
      root: "../..",
      framework: "nextjs",
      hintsFile: "./webprobe.hints.jsonc",
    });
    expect(config.bootstrap).toMatchObject({
      command: "pnpm dev",
      cwd: "..",
      readyUrl: "https://example.com/health",
      readyIndicator: "[data-testid='app-shell']",
      timeoutSeconds: 90,
    });
  });
});
