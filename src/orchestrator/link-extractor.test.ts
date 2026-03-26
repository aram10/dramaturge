import { describe, it, expect } from "vitest";
import { deduplicateLinks, isNavigationLink } from "./link-extractor.js";

describe("isNavigationLink", () => {
  const base = "https://app.example.com";

  it("accepts same-origin absolute URLs", () => {
    expect(isNavigationLink("https://app.example.com/settings", base)).toBe(true);
  });

  it("accepts relative URLs", () => {
    expect(isNavigationLink("/dashboard", base)).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isNavigationLink("https://google.com", base)).toBe(false);
  });

  it("rejects anchor-only links", () => {
    expect(isNavigationLink("#section", base)).toBe(false);
  });

  it("rejects javascript: links", () => {
    expect(isNavigationLink("javascript:void(0)", base)).toBe(false);
  });

  it("rejects mailto: links", () => {
    expect(isNavigationLink("mailto:admin@example.com", base)).toBe(false);
  });

  it("rejects blob/data URLs", () => {
    expect(isNavigationLink("blob:https://app.example.com/abc", base)).toBe(false);
    expect(isNavigationLink("data:text/html,<h1>hi</h1>", base)).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(isNavigationLink("", base)).toBe(false);
  });

  it("rejects tel: links", () => {
    expect(isNavigationLink("tel:+1234567890", base)).toBe(false);
  });
});

describe("deduplicateLinks", () => {
  it("removes duplicate paths", () => {
    const links = [
      { url: "https://app.example.com/a", text: "A" },
      { url: "https://app.example.com/a", text: "Also A" },
      { url: "https://app.example.com/b", text: "B" },
    ];
    expect(deduplicateLinks(links)).toHaveLength(2);
  });

  it("normalizes trailing slashes", () => {
    const links = [
      { url: "https://app.example.com/a/", text: "A" },
      { url: "https://app.example.com/a", text: "A" },
    ];
    expect(deduplicateLinks(links)).toHaveLength(1);
  });

  it("handles root path dedup", () => {
    const links = [
      { url: "https://app.example.com/", text: "Home" },
      { url: "https://app.example.com", text: "Home" },
    ];
    expect(deduplicateLinks(links)).toHaveLength(1);
  });

  it("skips malformed URLs", () => {
    const links = [
      { url: "https://app.example.com/a", text: "A" },
      { url: "not a valid url without scheme", text: "Bad" },
    ];
    const result = deduplicateLinks(links);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
