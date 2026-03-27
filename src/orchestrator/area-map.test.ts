import { describe, expect, it } from "vitest";
import { deduplicateAreas } from "./area-map.js";

describe("deduplicateAreas", () => {
  it("keeps areas distinct when meaningful query params differ", () => {
    const areas = deduplicateAreas([
      {
        name: "KB One",
        url: "https://example.com/?kb=one",
      },
      {
        name: "KB Two",
        url: "https://example.com/?kb=two",
      },
    ]);

    expect(areas).toHaveLength(2);
  });

  it("collapses areas that differ only by tracking params", () => {
    const areas = deduplicateAreas([
      {
        name: "Knowledge Bases",
        url: "https://example.com/manage/knowledge-bases",
      },
      {
        name: "Knowledge Bases Email",
        url: "https://example.com/manage/knowledge-bases?utm_source=email",
      },
    ]);

    expect(areas).toHaveLength(1);
  });
});
