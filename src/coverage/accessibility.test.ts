import { describe, expect, it, vi } from "vitest";
import {
  buildAccessibilityArtifacts,
  mapAxeImpactToSeverity,
  runAccessibilityScan,
} from "./accessibility.js";

describe("accessibility scanning", () => {
  it("maps axe impact levels to Dramaturge severities", () => {
    expect(mapAxeImpactToSeverity("critical")).toBe("Critical");
    expect(mapAxeImpactToSeverity("serious")).toBe("Major");
    expect(mapAxeImpactToSeverity("moderate")).toBe("Minor");
    expect(mapAxeImpactToSeverity("minor")).toBe("Trivial");
    expect(mapAxeImpactToSeverity(undefined)).toBe("Minor");
  });

  it("builds deterministic accessibility findings and evidence", () => {
    const { findings, evidence } = buildAccessibilityArtifacts({
      areaName: "Knowledge bases",
      route: "https://example.com/manage/knowledge-bases",
      violations: [
        {
          id: "button-name",
          impact: "serious",
          help: "Buttons must have discernible text",
          helpUrl: "https://dequeuniversity.com/rules/axe/button-name",
          nodes: [
            {
              target: ["button.icon-only"],
              failureSummary: "Fix any of the following: Element does not have inner text",
            },
          ],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(evidence).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "Accessibility Issue",
      severity: "Major",
      title: "A11y: Buttons must have discernible text",
      evidenceIds: [evidence[0].id],
      verdict: {
        hypothesis: "The page should satisfy the accessibility rule button-name.",
        observation: "1 element(s) violated the rule Buttons must have discernible text.",
      },
      meta: {
        source: "auto-capture",
      },
    });
    expect(findings[0].verdict?.evidenceChain).toContain("button.icon-only");
    expect(findings[0].meta?.repro?.breadcrumbs).toContain(
      "auto-captured accessibility violation button-name"
    );
    expect(evidence[0]).toMatchObject({
      type: "accessibility-scan",
      areaName: "Knowledge bases",
    });
  });

  it("runs the provided analyzer and converts its violations", async () => {
    const analyze = vi.fn().mockResolvedValue({
      violations: [
        {
          id: "image-alt",
          impact: "critical",
          help: "Images must have alternate text",
          nodes: [{ target: ["img.hero"] }],
        },
      ],
    });

    const result = await runAccessibilityScan(
      {} as any,
      "Landing",
      "https://example.com/",
      analyze
    );

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.findings[0]).toMatchObject({
      category: "Accessibility Issue",
      severity: "Critical",
      title: "A11y: Images must have alternate text",
    });
  });
});
