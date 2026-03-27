import type {
  BrowserConsoleError,
  BrowserNetworkError,
  BrowserPageError,
} from "../types.js";
import type { RepoHints } from "../adaptation/types.js";
import type { PolicyConfig } from "./types.js";

type ConsoleLikeError = BrowserConsoleError | BrowserPageError;

export type SuppressibleFinding =
  | { type: "network"; error: BrowserNetworkError }
  | { type: "console"; error: ConsoleLikeError };

export function resolvePolicy(
  config?: PolicyConfig,
  repoHints?: RepoHints
): PolicyConfig {
  return {
    expectedResponses: [
      ...(config?.expectedResponses ?? []),
      ...(repoHints?.expectedHttpNoise ?? []),
    ],
    ignoredConsolePatterns: [...(config?.ignoredConsolePatterns ?? [])],
  };
}

function normalizePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function isExpectedNetworkResponse(
  error: BrowserNetworkError,
  rules: PolicyConfig["expectedResponses"]
): boolean {
  const pathname = normalizePath(error.url);
  const method = error.method.toUpperCase();

  return rules.some((rule) => {
    const ruleMethod = rule.method?.toUpperCase();
    return (
      (!ruleMethod || ruleMethod === method) &&
      rule.statuses.includes(error.status) &&
      pathname.startsWith(rule.pathPrefix)
    );
  });
}

export function isIgnoredConsoleError(
  error: ConsoleLikeError,
  patterns: string[]
): boolean {
  const message = ("text" in error ? error.text : error.message).toLowerCase();
  return patterns.some((pattern) => message.includes(pattern.toLowerCase()));
}

export function shouldSuppressFinding(
  finding: SuppressibleFinding,
  policy: PolicyConfig
): boolean {
  if (finding.type === "network") {
    return isExpectedNetworkResponse(
      finding.error,
      policy.expectedResponses
    );
  }

  return isIgnoredConsoleError(
    finding.error,
    policy.ignoredConsolePatterns
  );
}
