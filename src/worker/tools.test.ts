import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRecorder } from "./action-recorder.js";
import { createWorkerTools } from "./tools.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dramaturge-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("createWorkerTools", () => {
  it("writes screenshots with an internal filename instead of the agent ref", async () => {
    const screenshotDir = createTempDir();
    const findings: any[] = [];
    const evidence: any[] = [];
    const screenshots = new Map<string, Buffer>();
    const actionRecorder = new ActionRecorder();
    const tools = createWorkerTools(
      findings,
      screenshots,
      evidence,
      { recordEvent: vi.fn() } as any,
      {
        url: () => "https://example.com/manage/knowledge-bases",
        screenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
      } as any,
      screenshotDir,
      "Knowledge bases",
      [],
      [],
      true,
      undefined,
      undefined,
      actionRecorder
    );

    const result = await tools.take_screenshot.execute({
      ref: "../escape/outside",
      annotation: "Broken dialog",
    });

    expect(result.captured).toBe(true);
    expect(result.filename).toBeDefined();
    expect(result.filename).toMatch(/^ss-[A-Za-z0-9_-]+\.png$/);
    expect(result.filename).not.toContain("..");
    expect(result.filename).not.toContain("/");
    expect(existsSync(join(screenshotDir, result.filename!))).toBe(true);
    expect(evidence[0]).toMatchObject({
      id: result.evidenceId,
      path: `screenshots/${result.filename}`,
      summary: "Broken dialog",
    });
  });

  it("links evidence back to a stable finding ref instead of an array index", async () => {
    const screenshotDir = createTempDir();
    const findings: any[] = [];
    const evidence: any[] = [];
    const screenshots = new Map<string, Buffer>();
    const actionRecorder = new ActionRecorder();
    const tools = createWorkerTools(
      findings,
      screenshots,
      evidence,
      { recordEvent: vi.fn() } as any,
      {
        url: () => "https://example.com/manage/knowledge-bases",
        screenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
      } as any,
      screenshotDir,
      "Knowledge bases",
      [],
      [],
      true,
      undefined,
      undefined,
      actionRecorder
    );

    const shot = await tools.take_screenshot.execute({
      ref: "create-button",
      annotation: "Create button before click",
    });
    expect(shot.evidenceId).toBeDefined();

    await tools.log_finding.execute({
      category: "Bug",
      severity: "Major",
      title: "Create button stops responding",
      stepsToReproduce: ["Open the page", "Click Create"],
      expected: "A dialog opens",
      actual: "Nothing happens",
      evidenceIds: [shot.evidenceId!],
    });

    expect(findings[0].ref).toMatch(/^fid-/);
    expect(evidence[0].relatedFindingIds).toEqual([findings[0].ref]);
    expect(evidence[0].relatedFindingIds).not.toEqual(["0"]);
    expect(findings[0].verdict).toMatchObject({
      hypothesis: "A dialog opens",
      observation: "Nothing happens",
      evidenceChain: [shot.evidenceId],
    });
    expect(findings[0].meta?.repro?.actionIds).toHaveLength(1);
  });
});
