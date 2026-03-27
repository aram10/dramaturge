import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildVerifyStandaloneHelpText,
  parseVerifyStandaloneArgs,
  scanPackageTextFiles,
} from "../scripts/verify-standalone.mjs";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dramaturge-standalone-verify-"));
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

describe("parseVerifyStandaloneArgs", () => {
  it("parses help and keep-temp flags", () => {
    expect(parseVerifyStandaloneArgs(["--help"])).toEqual({
      keepTemp: false,
      packFile: undefined,
      showHelp: true,
      tempDir: undefined,
    });

    expect(parseVerifyStandaloneArgs(["--keep-temp", "--temp-dir", "C:/tmp/run"])).toEqual({
      keepTemp: true,
      packFile: undefined,
      showHelp: false,
      tempDir: "C:/tmp/run",
    });
  });

  it("accepts an explicit tarball path", () => {
    expect(parseVerifyStandaloneArgs(["--pack-file", "./dist/dramaturge.tgz"])).toEqual({
      keepTemp: false,
      packFile: "./dist/dramaturge.tgz",
      showHelp: false,
      tempDir: undefined,
    });
  });
});

describe("buildVerifyStandaloneHelpText", () => {
  it("describes the standalone verification workflow", () => {
    const helpText = buildVerifyStandaloneHelpText();

    expect(helpText).toContain("Usage: node scripts/verify-standalone.mjs");
    expect(helpText).toContain("--pack-file <path>");
    expect(helpText).toContain("--keep-temp");
  });
});

describe("scanPackageTextFiles", () => {
  it("reports forbidden host-repo references", () => {
    const packageDir = createTempDir();
    mkdirSync(join(packageDir, "docs"), { recursive: true });
    mkdirSync(join(packageDir, "examples"), { recursive: true });

    writeFileSync(
      join(packageDir, "README.md"),
      "Run pnpm local:up -- --backend-ref main before probing.",
      "utf-8"
    );
    writeFileSync(
      join(packageDir, "docs", "chatppt-smoke.md"),
      "Seed auth with npx tsx tests/interactive-login.ts.",
      "utf-8"
    );
    writeFileSync(
      join(packageDir, "examples", "standalone.local.profile.jsonc"),
      '{ "auth": { "stateFile": "../playwright/.auth/user.json" } }',
      "utf-8"
    );

    const issues = scanPackageTextFiles(packageDir);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "README.md",
          reason: "repo-root bootstrap command",
        }),
        expect.objectContaining({
          file: "docs/chatppt-smoke.md",
          reason: "external auth helper",
        }),
        expect.objectContaining({
          file: "examples/standalone.local.profile.jsonc",
          reason: "parent-directory config path",
        }),
      ])
    );
  });

  it("accepts standalone-safe docs and examples", () => {
    const packageDir = createTempDir();
    mkdirSync(join(packageDir, "docs"), { recursive: true });
    mkdirSync(join(packageDir, "examples"), { recursive: true });

    writeFileSync(
      join(packageDir, "README.md"),
      "Run pnpm exec dramaturge --config ./dramaturge.config.json.",
      "utf-8"
    );
    writeFileSync(
      join(packageDir, "docs", "standalone-extraction.md"),
      "Use dramaturge-auth-state to save browser state into ./.dramaturge-state/user.json.",
      "utf-8"
    );
    writeFileSync(
      join(packageDir, "examples", "standalone.local.profile.jsonc"),
      '{ "auth": { "stateFile": "./.dramaturge-state/user.json" } }',
      "utf-8"
    );

    expect(scanPackageTextFiles(packageDir)).toEqual([]);
  });
});
