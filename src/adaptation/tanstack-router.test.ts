import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { canScanTanStackRouterRepo, scanTanStackRouterRepo } from "./tanstack-router.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/tanstack-router-app", import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dramaturge-tanstack-scan-"));
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

describe("canScanTanStackRouterRepo", () => {
  it("returns true when a source file imports from @tanstack/react-router", () => {
    expect(canScanTanStackRouterRepo(fixtureRoot)).toBe(true);
  });

  it("returns false for an empty project", () => {
    const root = createTempDir();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "console.log('hello');", "utf-8");
    expect(canScanTanStackRouterRepo(root)).toBe(false);
  });
});

describe("scanTanStackRouterRepo", () => {
  it("extracts routes from createRoute config and createFileRoute calls", () => {
    const hints = scanTanStackRouterRepo(fixtureRoot);

    expect(hints.routes).toContain("/");
    expect(hints.routes).toContain("/dashboard");
    expect(hints.routes).toContain("/login");
    expect(hints.routes).toContain("/oauth/callback");
    expect(hints.routes).toContain("/settings/profile");
  });

  it("extracts file-based routes from routes directory", () => {
    const hints = scanTanStackRouterRepo(fixtureRoot);

    // __root.tsx -> / (root)
    // dashboard.lazy.tsx -> /dashboard
    // settings/profile.tsx -> /settings/profile
    expect(hints.routes).toContain("/");
    expect(hints.routes).toContain("/dashboard");
    expect(hints.routes).toContain("/settings/profile");
  });

  it("extracts route families", () => {
    const hints = scanTanStackRouterRepo(fixtureRoot);

    expect(hints.routeFamilies).toContain("/");
    expect(hints.routeFamilies).toContain("/dashboard");
    expect(hints.routeFamilies).toContain("/settings");
    expect(hints.routeFamilies).toContain("/login");
    expect(hints.routeFamilies).toContain("/oauth");
  });

  it("extracts auth hints", () => {
    const hints = scanTanStackRouterRepo(fixtureRoot);

    expect(hints.authHints.loginRoutes).toContain("/login");
    expect(hints.authHints.callbackRoutes).toContain("/oauth/callback");
  });

  it("extracts stable selectors", () => {
    const hints = scanTanStackRouterRepo(fixtureRoot);

    expect(hints.stableSelectors).toContain('[data-testid="main-nav"]');
    expect(hints.stableSelectors).toContain('[data-testid="logout-btn"]');
    expect(hints.stableSelectors).toContain('#home-link');
  });

  it("extracts API endpoints from fetch calls", () => {
    const hints = scanTanStackRouterRepo(fixtureRoot);

    expect(hints.apiEndpoints).toContainEqual(
      expect.objectContaining({
        route: "/api/users",
        methods: expect.arrayContaining(["GET", "POST"]),
      }),
    );
  });
});
