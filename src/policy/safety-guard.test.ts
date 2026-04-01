import { describe, it, expect } from "vitest";
import {
  SafetyGuard,
  createDefaultSafetyConfig,
  type SafetyGuardConfig,
} from "./safety-guard.js";

describe("SafetyGuard", () => {
  describe("checkUrl", () => {
    it("allows all URLs when no patterns are configured", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(true));
      expect(guard.checkUrl("http://example.com/dashboard")).toBeNull();
      expect(guard.checkUrl("http://example.com/settings")).toBeNull();
    });

    it("blocks URLs matching blocked patterns", () => {
      const config: SafetyGuardConfig = {
        ...createDefaultSafetyConfig(true),
        blockedUrlPatterns: ["/admin/**", "/api/internal/**"],
      };
      const guard = new SafetyGuard(config);

      expect(guard.checkUrl("http://example.com/admin/delete")).not.toBeNull();
      expect(guard.checkUrl("http://example.com/api/internal/reset")).not.toBeNull();
      expect(guard.checkUrl("http://example.com/dashboard")).toBeNull();
    });

    it("enforces allowed patterns when configured", () => {
      const config: SafetyGuardConfig = {
        ...createDefaultSafetyConfig(true),
        allowedUrlPatterns: ["/app/**", "/public/**"],
      };
      const guard = new SafetyGuard(config);

      expect(guard.checkUrl("http://example.com/app/dashboard")).toBeNull();
      expect(guard.checkUrl("http://example.com/admin/users")).not.toBeNull();
    });

    it("blocked patterns take priority over allowed patterns", () => {
      const config: SafetyGuardConfig = {
        ...createDefaultSafetyConfig(true),
        allowedUrlPatterns: ["/app/**"],
        blockedUrlPatterns: ["/app/admin/**"],
      };
      const guard = new SafetyGuard(config);

      expect(guard.checkUrl("http://example.com/app/dashboard")).toBeNull();
      expect(guard.checkUrl("http://example.com/app/admin/delete")).not.toBeNull();
    });
  });

  describe("checkRequest", () => {
    it("blocks DELETE requests when destructive actions are disabled", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));
      expect(guard.checkRequest("DELETE", "/api/users/123")).not.toBeNull();
    });

    it("allows DELETE requests when destructive actions are enabled", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(true));
      expect(guard.checkRequest("DELETE", "/api/users/123")).toBeNull();
    });

    it("allows GET requests regardless of config", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));
      expect(guard.checkRequest("GET", "/api/users")).toBeNull();
    });
  });

  describe("checkActionLabel", () => {
    it("blocks destructive action labels when configured", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));

      expect(guard.checkActionLabel("Delete account", "/settings")).not.toBeNull();
      expect(guard.checkActionLabel("Remove all items", "/cart")).not.toBeNull();
      expect(guard.checkActionLabel("Destroy workspace", "/workspace")).not.toBeNull();
    });

    it("allows non-destructive action labels", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));

      expect(guard.checkActionLabel("Save changes", "/settings")).toBeNull();
      expect(guard.checkActionLabel("Submit form", "/form")).toBeNull();
      expect(guard.checkActionLabel("Update profile", "/profile")).toBeNull();
    });

    it("allows destructive labels when destructive actions are enabled", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(true));
      expect(guard.checkActionLabel("Delete account", "/settings")).toBeNull();
    });
  });

  describe("audit log", () => {
    it("records all check actions in audit log", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));

      guard.checkUrl("http://example.com/page");
      guard.checkRequest("DELETE", "/api/data");
      guard.checkActionLabel("Save", "/form");

      const log = guard.getAuditLog();
      // checkUrl logs, checkRequest(DELETE) logs (blocked), checkActionLabel("Save") doesn't
      // log because "Save" is not a destructive keyword; but the call itself should log if blocked.
      // Actually checkRequest("GET") returns early before logging when it's not destructive.
      // So: checkUrl (1 log) + checkRequest DELETE (1 log blocked) = 2 logs
      // checkActionLabel("Save") doesn't match any keyword so returns null before logging.
      expect(log.length).toBe(2);
    });

    it("tracks blocked count", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));

      guard.checkUrl("http://example.com/page"); // allowed
      guard.checkRequest("DELETE", "/api/data"); // blocked
      guard.checkActionLabel("Delete all", "/admin"); // blocked

      expect(guard.blockedCount).toBe(2);
    });

    it("entries contain expected fields", () => {
      const guard = new SafetyGuard(createDefaultSafetyConfig(false));
      guard.checkRequest("DELETE", "/api/item");

      const entry = guard.getAuditLog()[0];
      expect(entry.timestamp).toBeTruthy();
      expect(entry.action).toBeTruthy();
      expect(entry.url).toBe("/api/item");
      expect(entry.reason).toBeTruthy();
      expect(entry.blocked).toBe(true);
    });
  });
});
