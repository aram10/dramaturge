import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./repo-scan.js";

const nextFixture = fileURLToPath(new URL("./fixtures/next-app", import.meta.url));
const reactRouterFixture = fileURLToPath(new URL("./fixtures/react-router-app", import.meta.url));
const expressFixture = fileURLToPath(new URL("./fixtures/express-app", import.meta.url));
const vueRouterFixture = fileURLToPath(new URL("./fixtures/vue-router-app", import.meta.url));
const djangoFixture = fileURLToPath(new URL("./fixtures/django-app", import.meta.url));
const tanstackFixture = fileURLToPath(new URL("./fixtures/tanstack-router-app", import.meta.url));
const genericFixture = fileURLToPath(new URL("./fixtures/generic-app", import.meta.url));

describe("scanRepository", () => {
  it("extracts routes, route families, selectors, API endpoints, auth hints, query routes, and expected auth noise from a Next.js repo", () => {
    const hints = scanRepository({
      root: nextFixture,
      framework: "nextjs",
    });

    expect(hints.routes).toContain("/");
    expect(hints.routes).toContain("/login");
    expect(hints.routes).toContain("/auth/callback");
    expect(hints.routes).toContain("/manage/knowledge-bases");
    expect(hints.routes).toContain("/?kb=starter");
    expect(hints.routes).toContain("/manage/knowledge-bases?status=pending");

    expect(hints.stableSelectors).toContain("#manage-kb-new-btn");
    expect(hints.stableSelectors).toContain('[data-testid="kb-filter-pending"]');
    expect(hints.stableSelectors).toContain('[data-testid="app-nav"]');

    expect(hints.routeFamilies).toContain("/");
    expect(hints.routeFamilies).toContain("/auth");
    expect(hints.routeFamilies).toContain("/login");
    expect(hints.routeFamilies).toContain("/manage");

    expect(hints.apiEndpoints).toContainEqual({
      route: "/api/manage/knowledge-bases",
      methods: ["GET", "POST"],
      statuses: [201, 400, 401, 403],
      authRequired: true,
      validationSchemas: ["CreateKnowledgeBaseSchema"],
    });

    expect(hints.authHints.loginRoutes).toContain("/login");
    expect(hints.authHints.callbackRoutes).toContain("/auth/callback");

    expect(hints.expectedHttpNoise).toContainEqual({
      pathPrefix: "/api/manage/knowledge-bases",
      statuses: [401, 403],
    });
  });

  describe("framework: auto", () => {
    it("detects Next.js via app directory", () => {
      const hints = scanRepository({ root: nextFixture, framework: "auto" });
      expect(hints.routes).toContain("/login");
      expect(hints.apiEndpoints.length).toBeGreaterThan(0);
    });

    it("detects React Router via react-router-dom import", () => {
      const hints = scanRepository({ root: reactRouterFixture, framework: "auto" });
      expect(hints.routes.length).toBeGreaterThan(0);
    });

    it("detects Express via express import", () => {
      const hints = scanRepository({ root: expressFixture, framework: "auto" });
      expect(hints.routes).toContain("/");
      expect(hints.apiEndpoints.length).toBeGreaterThan(0);
    });

    it("detects Vue Router via vue-router import", () => {
      const hints = scanRepository({ root: vueRouterFixture, framework: "auto" });
      expect(hints.routes.length).toBeGreaterThan(0);
    });

    it("detects Django via manage.py", () => {
      const hints = scanRepository({ root: djangoFixture, framework: "auto" });
      expect(hints.routes).toContain("/");
      expect(hints.routes).toContain("/login");
    });

    it("detects TanStack Router via @tanstack/react-router import", () => {
      const hints = scanRepository({ root: tanstackFixture, framework: "auto" });
      expect(hints.routes.length).toBeGreaterThan(0);
    });

    it("falls back to generic for unrecognized projects", () => {
      const hints = scanRepository({ root: genericFixture, framework: "auto" });
      expect(hints.routes.length).toBeGreaterThan(0);
    });
  });
});
