import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { canScanNuxtRepo, scanNuxtRepo } from "./nuxt.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/nuxt-app", import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dramaturge-nuxt-scan-"));
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

describe("canScanNuxtRepo", () => {
  it("returns true when nuxt.config.ts exists", () => {
    expect(canScanNuxtRepo(fixtureRoot)).toBe(true);
  });

  it("returns false for a non-Nuxt project", () => {
    const root = createTempDir();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "console.log('hello');", "utf-8");
    expect(canScanNuxtRepo(root)).toBe(false);
  });
});

describe("scanNuxtRepo", () => {
  it("extracts routes from file-based routing", () => {
    const hints = scanNuxtRepo(fixtureRoot);
    expect(hints.routes).toContain("/");
    expect(hints.routes).toContain("/dashboard");
    expect(hints.routes).toContain("/login");
    expect(hints.routes).toContain("/oauth/callback");
    expect(hints.routes).toContain("/api/users");
    expect(hints.routes).toContain("/api/users/:id");
  });

  it("extracts route families", () => {
    const hints = scanNuxtRepo(fixtureRoot);
    expect(hints.routeFamilies).toContain("/");
    expect(hints.routeFamilies).toContain("/dashboard");
    expect(hints.routeFamilies).toContain("/api");
    expect(hints.routeFamilies).toContain("/login");
    expect(hints.routeFamilies).toContain("/oauth");
  });

  it("extracts auth hints", () => {
    const hints = scanNuxtRepo(fixtureRoot);
    expect(hints.authHints.loginRoutes).toContain("/login");
    expect(hints.authHints.callbackRoutes).toContain("/oauth/callback");
  });

  it("extracts selectors from vue files", () => {
    const hints = scanNuxtRepo(fixtureRoot);
    expect(hints.stableSelectors).toContain('[data-testid="app-nav"]');
    expect(hints.stableSelectors).toContain('[data-testid="dashboard-main"]');
    expect(hints.stableSelectors).toContain('#home-hero');
  });

  it("detects API endpoints with methods", () => {
    const hints = scanNuxtRepo(fixtureRoot);
    expect(hints.apiEndpoints.length).toBeGreaterThan(0);
    const usersEndpoint = hints.apiEndpoints.find(ep => ep.route === "/api/users");
    expect(usersEndpoint).toBeDefined();
    expect(usersEndpoint?.methods).toContain("GET");
    expect(usersEndpoint?.methods).toContain("POST");
  });

  it("detects expected HTTP noise for auth-guarded routes", () => {
    const hints = scanNuxtRepo(fixtureRoot);
    expect(hints.expectedHttpNoise.length).toBeGreaterThan(0);
  });
});
