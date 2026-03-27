import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./repo-scan.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/next-app", import.meta.url));

describe("scanRepository", () => {
  it("extracts routes, route families, selectors, API endpoints, auth hints, query routes, and expected auth noise from a Next.js repo", () => {
    const hints = scanRepository({
      root: fixtureRoot,
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
});
