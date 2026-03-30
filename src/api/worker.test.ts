import { describe, expect, it, vi } from "vitest";
import { executeApiWorkerTask } from "./worker.js";
import { createContractIndex } from "../spec/contract-index.js";
import { buildOpenApiSpec } from "../spec/openapi-spec.js";

function createResponse(status: number, body: unknown, contentType = "application/json") {
  return {
    status: () => status,
    headers: async () => ({
      "content-type": contentType,
    }),
    text: async () =>
      typeof body === "string" ? body : JSON.stringify(body),
  };
}

describe("executeApiWorkerTask", () => {
  it("reports an authorization-boundary finding when an auth-required endpoint succeeds without auth", async () => {
    const result = await executeApiWorkerTask({
      taskId: "task-api-1",
      areaName: "Widgets",
      pageRoute: "https://example.com/widgets",
      targetUrl: "https://example.com",
      observedEndpoints: [
        {
          route: "/api/widgets",
          methods: ["GET"],
          statuses: [200],
          failures: [],
        },
      ],
      contractIndex: createContractIndex([
        buildOpenApiSpec({
          openapi: "3.1.0",
          info: { title: "Widgets API", version: "1.0.0" },
          paths: {
            "/api/widgets": {
              get: {
                security: [{ cookieAuth: [] }],
                responses: {
                  "200": {
                    description: "OK",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          required: ["items"],
                          properties: {
                            items: { type: "array" },
                          },
                        },
                      },
                    },
                  },
                  "401": {
                    description: "Unauthorized",
                  },
                },
              },
            },
          },
        }),
      ]),
      pageRequestContext: {
        fetch: vi.fn().mockResolvedValue(createResponse(200, { items: [] })),
      } as any,
      createIsolatedRequestContext: vi.fn().mockResolvedValue({
        fetch: vi.fn().mockResolvedValue(createResponse(200, { items: [] })),
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      config: {
        enabled: true,
        maxEndpointsPerNode: 4,
        maxProbeCasesPerEndpoint: 6,
        unauthenticatedProbes: true,
        allowMutatingProbes: false,
      },
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toContain("Authorization boundary failure");
    expect(result.findings[0]?.actual).toContain("Unauthenticated probe returned 200");
  });

  it("skips mutating probes when mutating probes are disabled", async () => {
    const pageFetch = vi.fn();
    const result = await executeApiWorkerTask({
      taskId: "task-api-2",
      areaName: "Widgets",
      pageRoute: "https://example.com/widgets",
      targetUrl: "https://example.com",
      observedEndpoints: [
        {
          route: "/api/widgets",
          methods: ["POST"],
          statuses: [201],
          failures: [],
        },
      ],
      contractIndex: createContractIndex([
        buildOpenApiSpec({
          openapi: "3.1.0",
          info: { title: "Widgets API", version: "1.0.0" },
          paths: {
            "/api/widgets": {
              post: {
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
                  },
                },
              },
            },
          },
        }),
      ]),
      pageRequestContext: {
        fetch: pageFetch,
      } as any,
      createIsolatedRequestContext: vi.fn(),
      config: {
        enabled: true,
        maxEndpointsPerNode: 4,
        maxProbeCasesPerEndpoint: 6,
        unauthenticatedProbes: true,
        allowMutatingProbes: false,
      },
    });

    expect(pageFetch).not.toHaveBeenCalled();
    expect(result.findings).toEqual([]);
  });
});
