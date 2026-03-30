import { readFileSync } from "node:fs";
import { parseJsoncObject } from "../utils/jsonc.js";
import { buildOpenApiSpec } from "./openapi-spec.js";
import type { NormalizedSpecArtifact } from "./types.js";

export function loadOpenApiSpec(filePath: string): NormalizedSpecArtifact {
  const raw = readFileSync(filePath, "utf-8");
  return buildOpenApiSpec(parseJsoncObject(raw));
}
