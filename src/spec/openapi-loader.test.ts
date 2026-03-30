import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOpenApiSpec } from "./openapi-loader.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dramaturge-openapi-loader-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadOpenApiSpec", () => {
  it("loads an OpenAPI JSON document from disk and normalizes it", () => {
    const dir = createTempDir();
    const filePath = join(dir, "dramaturge.openapi.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Test API", version: "1.0.0" },
        paths: {
          "/api/widgets": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                },
              },
            },
          },
        },
      }),
      "utf-8"
    );

    const spec = loadOpenApiSpec(filePath);

    expect(spec.routes).toContain("/api/widgets");
    expect(spec.operations["GET /api/widgets"]).toMatchObject({
      method: "GET",
      route: "/api/widgets",
      source: "openapi",
    });
  });
});
