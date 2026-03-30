import type { DramaturgeConfig } from "../config.js";
import type { ObservedApiEndpoint } from "../network/traffic-observer.js";
import type { ContractIndex } from "../spec/contract-index.js";
import type { NormalizedOperationSpec } from "../spec/types.js";

export type ApiTestingConfig = DramaturgeConfig["apiTesting"];

export interface ApiRequestResponseLike {
  status(): number;
  headers(): Promise<Record<string, string>> | Record<string, string>;
  text(): Promise<string>;
}

export interface ApiRequestContextLike {
  fetch(url: string, options?: Record<string, unknown>): Promise<ApiRequestResponseLike>;
  dispose?(): Promise<void>;
}

export interface ApiReplayRequest {
  url: string;
  method: string;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface ApiReplayResponse {
  status: number;
  body?: unknown;
}

export interface ApiProbeTarget {
  route: string;
  method: string;
  authRequired: boolean;
  operation?: NormalizedOperationSpec;
  observedStatuses: number[];
  source: "observed" | "contract";
}

export interface ExecuteApiWorkerTaskInput {
  taskId: string;
  areaName: string;
  pageRoute: string;
  targetUrl: string;
  observedEndpoints: ObservedApiEndpoint[];
  contractIndex?: ContractIndex;
  pageRequestContext: ApiRequestContextLike;
  createIsolatedRequestContext?: () => Promise<ApiRequestContextLike>;
  config: ApiTestingConfig;
}
