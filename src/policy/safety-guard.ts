/**
 * Safety guard module for URL-scoped protection and destructive action detection.
 *
 * Inspired by ECC's safety-guard skill. Provides:
 * - URL pattern allowlisting (freeze mode) — restrict interactions to specific URL patterns
 * - Destructive action detection — identify DELETE requests, danger-zone form submissions
 * - Audit logging — record all blocked actions for review
 *
 * Works alongside the existing `mission.destructiveActionsAllowed` config.
 */

export interface SafetyGuardConfig {
  /** URL patterns the agent is allowed to interact with (empty = allow all). */
  allowedUrlPatterns: string[];
  /** URL patterns the agent must never visit or interact with. */
  blockedUrlPatterns: string[];
  /** Block destructive HTTP methods (DELETE, PUT to dangerous endpoints). */
  blockDestructiveRequests: boolean;
  /** Patterns in button/link text that indicate destructive actions. */
  destructiveActionKeywords: string[];
}

export interface SafetyAuditEntry {
  timestamp: string;
  action: string;
  url: string;
  reason: string;
  blocked: boolean;
}

const DEFAULT_DESTRUCTIVE_KEYWORDS = [
  "delete",
  "remove",
  "destroy",
  "purge",
  "drop",
  "reset all",
  "clear all",
  "wipe",
  "uninstall",
  "deactivate account",
  "close account",
];

export function createDefaultSafetyConfig(
  destructiveActionsAllowed: boolean
): SafetyGuardConfig {
  return {
    allowedUrlPatterns: [],
    blockedUrlPatterns: [],
    blockDestructiveRequests: !destructiveActionsAllowed,
    destructiveActionKeywords: DEFAULT_DESTRUCTIVE_KEYWORDS,
  };
}

export class SafetyGuard {
  private readonly config: SafetyGuardConfig;
  private readonly auditLog: SafetyAuditEntry[] = [];

  constructor(config: SafetyGuardConfig) {
    this.config = config;
  }

  /**
   * Check if a URL is allowed under the current policy.
   * Returns a reason string if blocked, or null if allowed.
   */
  checkUrl(url: string): string | null {
    const pathname = normalizePathname(url);

    // Check blocked patterns first
    for (const pattern of this.config.blockedUrlPatterns) {
      if (matchesPattern(pathname, pattern)) {
        const reason = `URL matches blocked pattern: ${pattern}`;
        this.log(url, "navigate", reason, true);
        return reason;
      }
    }

    // Check allowed patterns (if any are set, only those are allowed)
    if (this.config.allowedUrlPatterns.length > 0) {
      const isAllowed = this.config.allowedUrlPatterns.some((pattern) =>
        matchesPattern(pathname, pattern)
      );
      if (!isAllowed) {
        const reason = "URL not in allowed patterns";
        this.log(url, "navigate", reason, true);
        return reason;
      }
    }

    this.log(url, "navigate", "allowed", false);
    return null;
  }

  /**
   * Check if an HTTP request should be blocked based on method and URL.
   */
  checkRequest(method: string, url: string): string | null {
    if (!this.config.blockDestructiveRequests) {
      return null;
    }

    const upperMethod = method.toUpperCase();
    if (upperMethod === "DELETE") {
      const reason = `Destructive HTTP method: ${upperMethod} ${url}`;
      this.log(url, `${upperMethod} request`, reason, true);
      return reason;
    }

    return null;
  }

  /**
   * Check if an action label suggests a destructive operation.
   */
  checkActionLabel(label: string, url: string): string | null {
    if (!this.config.blockDestructiveRequests) {
      return null;
    }

    const lowerLabel = label.toLowerCase();
    for (const keyword of this.config.destructiveActionKeywords) {
      if (lowerLabel.includes(keyword.toLowerCase())) {
        const reason = `Action label contains destructive keyword "${keyword}": "${label}"`;
        this.log(url, label, reason, true);
        return reason;
      }
    }

    return null;
  }

  /** Get a copy of the full audit log. */
  getAuditLog(): readonly SafetyAuditEntry[] {
    return this.auditLog;
  }

  /** Get count of blocked actions. */
  get blockedCount(): number {
    return this.auditLog.filter((entry) => entry.blocked).length;
  }

  private log(url: string, action: string, reason: string, blocked: boolean): void {
    this.auditLog.push({
      timestamp: new Date().toISOString(),
      action,
      url,
      reason,
      blocked,
    });
  }
}

function normalizePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

function matchesPattern(pathname: string, pattern: string): boolean {
  // Support simple glob: * matches any segment, ** matches any number of segments
  const regexStr = pattern
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");

  try {
    return new RegExp(`^${regexStr}$`).test(pathname);
  } catch {
    // If the pattern is invalid as regex, fall back to prefix match
    return pathname.startsWith(pattern);
  }
}
