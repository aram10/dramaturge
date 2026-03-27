import { describe, expect, it } from "vitest";
import {
  isExpectedNetworkResponse,
  isIgnoredConsoleError,
  resolvePolicy,
  shouldSuppressFinding,
} from "./policy.js";

describe("policy helpers", () => {
  it("treats configured 401/403 responses as expected environment noise", () => {
    const policy = resolvePolicy(
      {
        expectedResponses: [
          {
            pathPrefix: "/api/manage/knowledge-bases",
            statuses: [401, 403],
          },
        ],
        ignoredConsolePatterns: [],
      },
      {
        routes: [],
        stableSelectors: [],
        authHints: {
          loginRoutes: [],
          callbackRoutes: [],
        },
        expectedHttpNoise: [
          {
            pathPrefix: "/api/manage/knowledge-bases",
            statuses: [401, 403],
          },
        ],
      }
    );

    expect(
      isExpectedNetworkResponse(
        {
          method: "GET",
          url: "https://example.com/api/manage/knowledge-bases",
          status: 401,
          statusText: "Unauthorized",
          timestamp: new Date().toISOString(),
        },
        policy.expectedResponses
      )
    ).toBe(true);

    expect(
      shouldSuppressFinding(
        {
          type: "network",
          error: {
            method: "GET",
            url: "https://example.com/api/manage/knowledge-bases",
            status: 403,
            statusText: "Forbidden",
            timestamp: new Date().toISOString(),
          },
        },
        policy
      )
    ).toBe(true);
  });

  it("does not suppress unexpected 500 responses", () => {
    const policy = resolvePolicy({
      expectedResponses: [
        {
          pathPrefix: "/api/manage/knowledge-bases",
          statuses: [401, 403],
        },
      ],
      ignoredConsolePatterns: [],
    });

    expect(
      isExpectedNetworkResponse(
        {
          method: "GET",
          url: "https://example.com/api/manage/knowledge-bases",
          status: 500,
          statusText: "Internal Server Error",
          timestamp: new Date().toISOString(),
        },
        policy.expectedResponses
      )
    ).toBe(false);
  });

  it("ignores configured console noise patterns", () => {
    const policy = resolvePolicy({
      expectedResponses: [],
      ignoredConsolePatterns: ["ResizeObserver loop"],
    });

    expect(
      isIgnoredConsoleError(
        {
          level: "warning",
          text: "ResizeObserver loop limit exceeded",
          url: "https://example.com/app",
          timestamp: new Date().toISOString(),
        },
        policy.ignoredConsolePatterns
      )
    ).toBe(true);
  });
});
