import { describe, expect, it } from "vitest";
import { buildApiContractArtifacts } from "./contract-oracle.js";

describe("buildApiContractArtifacts", () => {
  it("flags unexpected statuses against repo-derived API expectations", () => {
    const artifacts = buildApiContractArtifacts({
      areaName: "Items",
      route: "https://example.com/items/42",
      observedEndpoints: [
        {
          route: "/api/items/42",
          methods: ["GET"],
          statuses: [500],
          failures: [],
        },
      ],
      repoHints: {
        routes: [],
        routeFamilies: [],
        stableSelectors: [],
        apiEndpoints: [
          {
            route: "/api/items/[id]",
            methods: ["GET"],
            statuses: [200, 404],
          },
        ],
        authHints: {
          loginRoutes: [],
          callbackRoutes: [],
        },
        expectedHttpNoise: [],
      },
    });

    expect(artifacts.findings).toHaveLength(1);
    expect(artifacts.evidence).toHaveLength(1);
    expect(artifacts.findings[0]).toMatchObject({
      category: "Bug",
      severity: "Major",
      title: "API contract deviation: GET /api/items/42",
    });
    expect(artifacts.findings[0].expected).toContain("200, 404");
    expect(artifacts.findings[0].actual).toContain("500");
    expect(artifacts.evidence[0]?.type).toBe("api-contract");
  });

  it("does not emit findings when observed traffic matches the expected contract", () => {
    const artifacts = buildApiContractArtifacts({
      areaName: "Members",
      route: "https://example.com/settings/members",
      observedEndpoints: [
        {
          route: "/api/settings/members",
          methods: ["GET"],
          statuses: [200],
          failures: [],
        },
      ],
      repoHints: {
        routes: [],
        routeFamilies: [],
        stableSelectors: [],
        apiEndpoints: [
          {
            route: "/api/settings/members",
            methods: ["GET"],
            statuses: [200, 304],
          },
        ],
        authHints: {
          loginRoutes: [],
          callbackRoutes: [],
        },
        expectedHttpNoise: [],
      },
    });

    expect(artifacts.findings).toEqual([]);
    expect(artifacts.evidence).toEqual([]);
  });
});
