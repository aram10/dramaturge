import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readPackageFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf-8");
}

describe("standalone package assets", () => {
  it("keeps package-owned docs and examples free of host-repo instructions", () => {
    const files = [
      "README.md",
      "docs/chatppt-smoke.md",
      "dramaturge.config.example.json",
      "examples/standalone.local.profile.jsonc",
      "examples/standalone.live.profile.jsonc",
      "examples/chatppt.local.profile.jsonc",
    ];

    const forbiddenPatterns = [
      /tests\/interactive-login\.ts/,
      /pnpm local:up/,
      /\.\.\/playwright/,
      /\bwebprobe\b/i,
    ];

    for (const file of files) {
      const contents = readPackageFile(file);
      for (const pattern of forbiddenPatterns) {
        expect(contents, `${file} should not contain ${pattern}`).not.toMatch(
          pattern
        );
      }
    }
  });

  it("ships a standalone extraction guide", () => {
    const guide = readPackageFile("docs/standalone-extraction.md");

    expect(guide).toContain("Standalone Extraction");
    expect(guide).toContain("GitHub Packages");
    expect(guide).toContain("dramaturge-auth-state");
  });

  it("keeps published package files scoped to standalone-safe docs", () => {
    const packageJson = JSON.parse(readPackageFile("package.json")) as {
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.files).toContain("docs/*.md");
    expect(packageJson.files).not.toContain("docs");
    expect(packageJson.scripts?.["verify:standalone"]).toBeDefined();
    expect(packageJson.scripts?.["pack:check"]).toBeDefined();
  });
});
