import { describe, expect, it } from "vitest";
import { replayApiRequest } from "./replay.js";

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

describe("replayApiRequest", () => {
  it("normalizes API responses into a status/body pair", async () => {
    const response = await replayApiRequest(
      {
        fetch: async () => createResponse(200, { id: "widget-1" }),
      } as any,
      {
        url: "https://example.com/api/widgets",
        method: "GET",
      }
    );

    expect(response).toEqual({
      status: 200,
      body: { id: "widget-1" },
    });
  });
});
