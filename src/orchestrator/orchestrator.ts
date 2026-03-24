import type { Stagehand } from "@browserbasehq/stagehand";
import type { WebProbeConfig } from "../config.js";
import type { Area, AreaResult } from "../types.js";
import { actionsToAreas, deduplicateAreas } from "./area-map.js";
import { exploreArea } from "../worker/worker.js";
import { join } from "node:path";

export interface OrchestratorResult {
  areaResults: AreaResult[];
  unexploredAreas: Array<{ name: string; reason: string }>;
}

export async function orchestrate(
  stagehand: Stagehand,
  config: WebProbeConfig,
  screenshotBaseDir: string
): Promise<OrchestratorResult> {
  const { targetUrl, appDescription, models, exploration } = config;
  const page = stagehand.context.pages()[0];

  console.log("Discovering navigation structure...");

  // Step 1: Observe navigation elements
  let areas: Area[];
  try {
    const actions = await stagehand.observe(
      "What navigation elements are on this page? List all links, menu items, sidebar entries, tabs, and buttons that navigate to different sections or pages of the application."
    );

    areas = deduplicateAreas(actionsToAreas(actions, targetUrl));
    console.log(
      `Discovered ${areas.length} areas: ${areas.map((a) => a.name).join(", ")}`
    );
  } catch (error) {
    console.warn(
      "Navigation discovery failed, exploring current page as single area."
    );
    areas = [
      { name: "Main Page", url: targetUrl, description: "The main/home page" },
    ];
  }

  // Step 2: Limit to maxAreasToExplore
  const maxAreas = exploration.maxAreasToExplore || areas.length;
  const areasToExplore = areas.slice(0, maxAreas);
  const skippedAreas = areas.slice(maxAreas);

  const areaResults: AreaResult[] = [];
  const unexploredAreas: Array<{ name: string; reason: string }> =
    skippedAreas.map((a) => ({
      name: a.name,
      reason: "exceeded maxAreasToExplore limit",
    }));

  const startTime = Date.now();
  const timeoutMs = exploration.totalTimeout * 1000;

  // Step 3: Dispatch workers sequentially
  for (let i = 0; i < areasToExplore.length; i++) {
    const area = areasToExplore[i];

    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      unexploredAreas.push({ name: area.name, reason: "timeout" });
      for (const r of areasToExplore.slice(i + 1)) {
        unexploredAreas.push({ name: r.name, reason: "timeout" });
      }
      break;
    }

    console.log(
      `\nExploring area: ${area.name}${area.url ? ` (${area.url})` : ""}...`
    );

    // Navigate to area
    try {
      if (area.url) {
        await page.goto(area.url);
      } else if (area.selector) {
        await stagehand.act({
          selector: area.selector,
          description: area.description ?? "click",
          method: "click",
          arguments: [],
        });
      } else {
        await stagehand.act(`Navigate to the "${area.name}" section`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to navigate to "${area.name}": ${message}`);
      areaResults.push({
        name: area.name,
        url: area.url,
        steps: 0,
        findings: [],
        screenshots: new Map(),
        status: "failed",
        failureReason: `Navigation failed: ${message}`,
      });
      continue;
    }

    // Launch worker
    const screenshotDir = join(screenshotBaseDir, "screenshots");
    const result = await exploreArea(
      stagehand,
      area,
      appDescription,
      models.worker,
      exploration.stepsPerArea,
      screenshotDir
    );
    areaResults.push(result);

    console.log(
      `  Completed: ${result.findings.length} findings, ${result.steps} steps, status: ${result.status}`
    );

    // Navigate back to root for next area
    try {
      await page.goto(targetUrl);
    } catch {
      console.warn("Failed to navigate back to root URL.");
    }
  }

  return { areaResults, unexploredAreas };
}
