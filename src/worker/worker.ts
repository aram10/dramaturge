import type { Stagehand } from "@browserbasehq/stagehand";
import { createWorkerTools } from "./tools.js";
import { buildWorkerSystemPrompt } from "./prompts.js";
import type { Area, AreaResult, RawFinding } from "../types.js";

export async function exploreArea(
  stagehand: Stagehand,
  area: Area,
  appDescription: string,
  model: string,
  stepsPerArea: number,
  screenshotDir: string
): Promise<AreaResult> {
  const findings: RawFinding[] = [];
  const screenshots = new Map<string, Buffer>();
  const page = stagehand.context.pages()[0];

  const tools = createWorkerTools(findings, screenshots, page, screenshotDir);

  const systemPrompt = buildWorkerSystemPrompt(
    appDescription,
    area.name,
    area.description
  );

  // Cast tools to any to work around Zod v3/v4 type mismatch in Stagehand's .d.ts.
  // At runtime the tool objects have the correct shape (description, inputSchema, execute).
  const agent = stagehand.agent({
    mode: "cua",
    model,
    systemPrompt,
    tools: tools as any,
  });

  try {
    const result = await agent.execute({
      instruction: `Explore the "${area.name}" area of this application. Interact with all visible elements, test forms, check edge cases, and report any issues you find using the log_finding tool. Take screenshots of anything notable using the take_screenshot tool.`,
      maxSteps: stepsPerArea,
    });

    // AgentResult.actions may not exist on all return types; access safely
    const stepCount =
      "actions" in result && Array.isArray(result.actions)
        ? result.actions.length
        : 0;

    return {
      name: area.name,
      url: area.url,
      steps: stepCount,
      findings,
      screenshots,
      status: "explored" as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Worker failed for area "${area.name}": ${message}`);

    return {
      name: area.name,
      url: area.url,
      steps: 0,
      findings,
      screenshots,
      status: "failed",
      failureReason: message,
    };
  }
}
