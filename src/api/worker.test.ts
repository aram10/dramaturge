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

  it("does not fall back to the authenticated page context when isolated auth probes cannot be created", async () => {
    const pageFetch = vi.fn().mockResolvedValue(createResponse(200, { items: [] }));
    const result = await executeApiWorkerTask({
      taskId: "task-api-3",
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
                  "200": { description: "OK" },
                  "401": { description: "Unauthorized" },
                },
              },
            },
          },
        }),
      ]),
      pageRequestContext: {
        fetch: pageFetch,
      } as any,
      createIsolatedRequestContext: vi.fn().mockRejectedValue(new Error("no isolated context")),
      config: {
        enabled: true,
        maxEndpointsPerNode: 4,
        maxProbeCasesPerEndpoint: 6,
        unauthenticatedProbes: true,
        allowMutatingProbes: false,
      },
    });

    expect(pageFetch).toHaveBeenCalledTimes(1);
    expect(result.findings).toEqual([]);
  });

  it("does not report redirect-to-login responses as authorization bypasses", async () => {
    const result = await executeApiWorkerTask({
      taskId: "task-api-4",
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
                  "200": { description: "OK" },
                  "401": { description: "Unauthorized" },
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
        fetch: vi.fn().mockResolvedValue(createResponse(302, "" as any, "text/plain")),
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

    expect(result.findings).toEqual([]);
  });

  it("replays observed request shape including query string, headers, and body when sample data exists", async () => {
    const pageFetch = vi.fn().mockResolvedValue(createResponse(201, { id: "widget-1" }));

    await executeApiWorkerTask({
      taskId: "task-api-5",
      areaName: "Widgets",
      pageRoute: "https://example.com/widgets",
      targetUrl: "https://example.com",
      observedEndpoints: [
        {
          route: "/api/widgets",
          methods: ["POST"],
          statuses: [201],
          failures: [],
          samples: [
            {
              method: "POST",
              status: 201,
              url: "/api/widgets?draft=true",
              headers: {
                "content-type": "application/json",
                "x-requested-with": "fetch",
              },
              data: { name: "Widget" },
            },
          ],
        } as any,
      ],
      pageRequestContext: {
        fetch: pageFetch,
      } as any,
      createIsolatedRequestContext: vi.fn(),
      config: {
        enabled: true,
        maxEndpointsPerNode: 4,
        maxProbeCasesPerEndpoint: 6,
        unauthenticatedProbes: false,
        allowMutatingProbes: true,
      },
    });

    expect(pageFetch).toHaveBeenCalledWith("https://example.com/api/widgets?draft=true", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-requested-with": "fetch",
      },
      data: { name: "Widget" },
    });
  });
});
