export type JsonSchema = Record<string, unknown>;

export type NormalizedSpecSource = "repo" | "openapi" | "traffic" | "inferred";

export interface NormalizedParamSpec {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema?: JsonSchema;
}

export interface NormalizedRequestBodySpec {
  required: boolean;
  schema?: JsonSchema;
  schemaName?: string;
}

export interface NormalizedResponseSpec {
  status: string;
  description?: string;
  schema?: JsonSchema;
}

export interface NormalizedOperationSpec {
  id: string;
  method: string;
  route: string;
  source: NormalizedSpecSource;
  authRequired?: boolean;
  requestBody?: NormalizedRequestBodySpec;
  responses: Record<string, NormalizedResponseSpec>;
  queryParams: NormalizedParamSpec[];
  pathParams: NormalizedParamSpec[];
  validationSchemas: string[];
}

export interface NormalizedSpecArtifact {
  routes: string[];
  operations: Record<string, NormalizedOperationSpec>;
}
