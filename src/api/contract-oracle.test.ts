import { describe, expect, it } from "vitest";
import { buildApiContractArtifacts } from "./contract-oracle.js";
import { createContractIndex } from "../spec/contract-index.js";
import { buildOpenApiSpec } from "../spec/openapi-spec.js";

describe("buildApiContractArtifacts", () => {
  it("flags unexpected statuses against contract-index API expectations", () => {
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
      contractIndex: createContractIndex([
        {
          routes: ["/api/items/[id]"],
          operations: {
            "GET /api/items/[id]": {
              id: "GET /api/items/[id]",
              method: "GET",
              route: "/api/items/[id]",
              source: "repo",
              responses: {
                "200": { status: "200" },
                "404": { status: "404" },
              },
              queryParams: [],
              pathParams: [],
              validationSchemas: [],
            },
          },
        },
      ]),
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

  it("flags invalid response bodies when the status is allowed but the schema is wrong", () => {
    const artifacts = buildApiContractArtifacts({
      areaName: "Widgets",
      route: "https://example.com/widgets",
      observedEndpoints: [
        {
          route: "/api/widgets",
          methods: ["POST"],
          statuses: [201],
          failures: [],
          responses: [
            {
              status: 201,
              body: { ok: true },
            },
          ],
        },
      ],
      contractIndex: createContractIndex([
        buildOpenApiSpec({
          openapi: "3.1.0",
          info: { title: "Widgets API", version: "1.0.0" },
          paths: {
            "/api/widgets": {
              post: {
                responses: {
                  "201": {
                    description: "Created",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          required: ["id"],
                          properties: {
                            id: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]),
    });

    expect(artifacts.findings).toHaveLength(1);
    expect(artifacts.findings[0]?.actual).toContain("Schema validation failed");
  });

  it("does not conflate statuses across different methods on the same route", () => {
    const artifacts = buildApiContractArtifacts({
      areaName: "Widgets",
      route: "https://example.com/widgets",
      observedEndpoints: [
        {
          route: "/api/widgets",
          methods: ["GET", "POST"],
          statuses: [200, 201],
          failures: [],
          samples: [
            {
              method: "GET",
              status: 200,
              url: "/api/widgets",
            },
            {
              method: "POST",
              status: 201,
              url: "/api/widgets",
            },
          ],
        } as any,
      ],
      contractIndex: createContractIndex([
        buildOpenApiSpec({
          openapi: "3.1.0",
          info: { title: "Widgets API", version: "1.0.0" },
          paths: {
            "/api/widgets": {
              get: {
                responses: {
                  "200": {
                    description: "OK",
                  },
                },
              },
              post: {
                responses: {
                  "201": {
                    description: "Created",
                  },
                },
              },
            },
          },
        }),
      ]),
    });

    expect(artifacts.findings).toEqual([]);
    expect(artifacts.evidence).toEqual([]);
  });

  it("flags unexpected methods when a route is observed outside the normalized contract", () => {
    const artifacts = buildApiContractArtifacts({
      areaName: "Widgets",
      route: "https://example.com/widgets",
      observedEndpoints: [
        {
          route: "/api/widgets",
          methods: ["DELETE"],
          statuses: [204],
          failures: [],
          samples: [
            {
              method: "DELETE",
              status: 204,
              url: "/api/widgets",
            },
          ],
        } as any,
      ],
      contractIndex: createContractIndex([
        buildOpenApiSpec({
          openapi: "3.1.0",
          info: { title: "Widgets API", version: "1.0.0" },
          paths: {
            "/api/widgets": {
              get: {
                responses: {
                  "200": {
                    description: "OK",
                  },
                },
              },
            },
          },
        }),
      ]),
    });

    expect(artifacts.findings).toHaveLength(1);
    expect(artifacts.findings[0]?.title).toContain("DELETE /api/widgets");
    expect(artifacts.findings[0]?.actual).toContain("methods=DELETE");
    expect(artifacts.findings[0]?.expected).toContain("methods=GET");
  });
});
