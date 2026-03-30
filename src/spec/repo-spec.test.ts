import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../adaptation/repo-scan.js";
import { buildRepoSpec } from "./repo-spec.js";

const fixtureRoot = fileURLToPath(new URL("../adaptation/fixtures/next-app", import.meta.url));

describe("buildRepoSpec", () => {
  it("normalizes repo hints into route and operation contracts", () => {
    const repoHints = scanRepository({
      root: fixtureRoot,
      framework: "nextjs",
    });

    const spec = buildRepoSpec(repoHints);

    expect(spec.routes).toContain("/api/manage/knowledge-bases");
    expect(spec.operations["POST /api/manage/knowledge-bases"]).toMatchObject({
      route: "/api/manage/knowledge-bases",
      method: "POST",
      source: "repo",
      authRequired: true,
      validationSchemas: ["CreateKnowledgeBaseSchema"],
      requestBody: {
        required: true,
        schemaName: "CreateKnowledgeBaseSchema",
      },
      responses: {
        "201": expect.objectContaining({ status: "201" }),
        "400": expect.objectContaining({ status: "400" }),
        "401": expect.objectContaining({ status: "401" }),
        "403": expect.objectContaining({ status: "403" }),
      },
    });
  });
});
