import { describe, expect, it } from "vitest";
import { buildOpenApiSpec } from "./openapi-spec.js";

describe("buildOpenApiSpec", () => {
  it("normalizes OpenAPI operations into the shared contract format", () => {
    const spec = buildOpenApiSpec({
      openapi: "3.1.0",
      info: {
        title: "Widgets API",
        version: "1.0.0",
      },
      paths: {
        "/api/widgets": {
          post: {
            operationId: "createWidget",
            security: [{ cookieAuth: [] }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: {
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
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
              "400": {
                description: "Bad Request",
              },
            },
          },
        },
      },
    });

    expect(spec.routes).toContain("/api/widgets");
    expect(spec.operations["POST /api/widgets"]).toMatchObject({
      id: "createWidget",
      method: "POST",
      route: "/api/widgets",
      source: "openapi",
      authRequired: true,
      requestBody: {
        required: true,
      },
      responses: {
        "201": expect.objectContaining({
          status: "201",
          description: "Created",
        }),
        "400": expect.objectContaining({
          status: "400",
          description: "Bad Request",
        }),
      },
    });
  });
});
