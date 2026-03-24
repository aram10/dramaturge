import { Stagehand } from "@browserbasehq/stagehand";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WebProbeConfig } from "./config.js";
import { authenticate } from "./auth/authenticator.js";
import { orchestrate } from "./orchestrator/orchestrator.js";
import { buildRunResult } from "./report/collector.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderJson } from "./report/json.js";

export async function run(config: WebProbeConfig): Promise<void> {
  const startTime = new Date();
  const timestamp = startTime
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outputDir = resolve(join(config.output.dir, timestamp));
  mkdirSync(join(outputDir, "screenshots"), { recursive: true });

  console.log(`WebProbe starting — target: ${config.targetUrl}`);
  console.log(`Output: ${outputDir}`);

  // Initialize Stagehand
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: config.models.orchestrator,
    localBrowserLaunchOptions: {
      headless: false,
    },
    verbose: 0,
  });

  await stagehand.init();

  let partial = false;

  try {
    // Authenticate
    console.log(`\nAuthenticating (strategy: ${config.auth.type})...`);
    await authenticate(stagehand, config);
    console.log("Authentication successful.");

    // Orchestrate exploration
    console.log("\nStarting exploration...");
    const { areaResults, unexploredAreas } = await orchestrate(
      stagehand,
      config,
      outputDir
    );

    partial = unexploredAreas.some((a) => a.reason === "timeout");

    // Build result
    const result = buildRunResult(
      config.targetUrl,
      startTime,
      areaResults,
      unexploredAreas,
      partial
    );

    // Generate reports
    const format = config.output.format;
    if (format === "markdown" || format === "both") {
      const md = renderMarkdown(result);
      writeFileSync(join(outputDir, "report.md"), md, "utf-8");
      console.log(`\nMarkdown report: ${join(outputDir, "report.md")}`);
    }
    if (format === "json" || format === "both") {
      const json = renderJson(result);
      writeFileSync(join(outputDir, "report.json"), json, "utf-8");
      console.log(`JSON report: ${join(outputDir, "report.json")}`);
    }

    // Summary
    const totalFindings = areaResults.reduce(
      (sum, a) => sum + a.findings.length,
      0
    );
    const exploredCount = areaResults.filter(
      (a) => a.status === "explored"
    ).length;
    console.log(
      `\nDone. ${exploredCount} areas explored, ${totalFindings} finding(s) reported.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nFatal error: ${message}`);
    process.exit(1);
  } finally {
    await stagehand.context.close();
  }
}
