import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { scanGenericRepo } from "./generic.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/generic-app", import.meta.url));

describe("scanGenericRepo", () => {
  it("extracts useful route, selector, auth, and API hints from a non-Next repo", () => {
    const hints = scanGenericRepo(fixtureRoot);

    expect(hints.routes).toContain("/");
    expect(hints.routes).toContain("/settings/profile");
    expect(hints.stableSelectors).toContain('[data-testid="settings-save"]');
    expect(hints.apiEndpoints).toContainEqual({
      route: "/api/widgets",
      methods: ["GET"],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.apiEndpoints).toContainEqual({
      route: "/api/billing/invoices",
      methods: ["POST"],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.authHints.loginRoutes).toContain("/signin");
    expect(hints.authHints.callbackRoutes).toContain("/oauth/callback");
  });
});
