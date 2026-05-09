// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { request as playwrightRequest } from 'playwright';
import { z } from 'zod';
import {
  ConfigSchema,
  loadConfig,
  resolveOutputFormats,
  type DramaturgeConfig,
  type LoadedDramaturgeConfig,
} from '../config.js';
import { normalizeConfigPaths, type ConfigFileContext } from '../config-paths.js';
import { buildSmokePreset, FOCUS_MODES, resolveProviderDefaults } from '../config-inline.js';
import { runEngine, type RunEngineOptions } from '../engine.js';
import { detectProviderFromEnv } from '../llm/index.js';
import { replayApiRequest } from '../api/replay.js';
import { createContractIndex, validateOperationResponse } from '../spec/contract-index.js';
import { buildOpenApiSpec } from '../spec/openapi-spec.js';
import { loadOpenApiSpec } from '../spec/openapi-loader.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const REGISTRY_DIR = '.dramaturge';
const REGISTRY_FILE = 'mcp-runs.json';
const FOCUS_MODE_ENUM = z.enum(FOCUS_MODES);

const RunExplorationArgsSchema = z.object({
  targetUrl: z.string().url(),
  configPath: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  profile: z.string().min(1).optional(),
  diffRef: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
});

const TestPageArgsSchema = z.object({
  url: z.string().url(),
  focusAreas: z.array(FOCUS_MODE_ENUM).min(1).optional(),
  configPath: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  profile: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
});

const ReadRunArgsSchema = z.object({
  runId: z.string().min(1),
});

const ProbeApiArgsSchema = z.object({
  endpoint: z.string().min(1),
  baseUrl: z.string().url().optional(),
  method: z.string().min(1).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  specPath: z.string().min(1).optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
});

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
  };
}

export interface DramaturgeMcpServer {
  handleRequest(
    request: JsonRpcRequest
  ): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined>;
}

interface RunRegistryEntry {
  outputDir: string;
  targetUrl: string;
  createdAt: string;
}

type RunRegistry = Record<string, RunRegistryEntry>;

export interface McpServerDependencies {
  cwd: string;
  loadConfig: (configPath?: string) => LoadedDramaturgeConfig;
  runEngine: (config: DramaturgeConfig, options?: RunEngineOptions) => Promise<void>;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  generateRunId: () => string;
}

const DEFAULT_MCP_DEPENDENCIES: McpServerDependencies = {
  cwd: process.cwd(),
  loadConfig,
  runEngine,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  generateRunId: () => `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`,
};

const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: 'run_exploration',
    description:
      'Run a full Dramaturge exploration against a target URL and save a reusable report.',
    inputSchema: {
      type: 'object',
      properties: {
        targetUrl: { type: 'string', format: 'uri' },
        configPath: { type: 'string' },
        config: { type: 'object', additionalProperties: true },
        profile: { type: 'string' },
        diffRef: { type: 'string' },
        runId: { type: 'string' },
      },
      required: ['targetUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'test_page',
    description:
      'Run a targeted smoke-style exploration for a specific page or flow, optionally scoped to focus areas.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        focusAreas: {
          type: 'array',
          items: { type: 'string', enum: [...FOCUS_MODES] },
        },
        configPath: { type: 'string' },
        config: { type: 'object', additionalProperties: true },
        profile: { type: 'string' },
        runId: { type: 'string' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_findings',
    description: 'Load findings from a previously completed Dramaturge MCP run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: 'probe_api',
    description:
      'Replay an API request and optionally validate the response against an OpenAPI spec.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string' },
        baseUrl: { type: 'string', format: 'uri' },
        method: { type: 'string' },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        body: {},
        specPath: { type: 'string' },
        spec: { type: 'object', additionalProperties: true },
      },
      required: ['endpoint'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_coverage_report',
    description: 'Load coverage and blind-spot information from a previously completed MCP run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
];

function createRegistryPath(cwd: string): string {
  return resolve(cwd, REGISTRY_DIR, REGISTRY_FILE);
}

function readRegistry(cwd: string): RunRegistry {
  const registryPath = createRegistryPath(cwd);
  if (!existsSync(registryPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as unknown;
  if (!isRecord(parsed)) {
    return {};
  }

  const registry: RunRegistry = {};
  for (const [runId, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) {
      continue;
    }
    const outputDir = entry.outputDir;
    const targetUrl = entry.targetUrl;
    const createdAt = entry.createdAt;
    if (
      typeof outputDir === 'string' &&
      typeof targetUrl === 'string' &&
      typeof createdAt === 'string'
    ) {
      registry[runId] = { outputDir, targetUrl, createdAt };
    }
  }
  return registry;
}

function writeRegistry(cwd: string, registry: RunRegistry): void {
  const registryPath = createRegistryPath(cwd);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

function registerRun(cwd: string, runId: string, outputDir: string, targetUrl: string): void {
  const registry = readRegistry(cwd);
  registry[runId] = {
    outputDir,
    targetUrl,
    createdAt: new Date().toISOString(),
  };
  writeRegistry(cwd, registry);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    merged[key] = isRecord(existing) && isRecord(value) ? mergeRecords(existing, value) : value;
  }
  return merged;
}

function ensureJsonReport(config: DramaturgeConfig): DramaturgeConfig {
  const formats = resolveOutputFormats(config.output.format);
  const nextFormats: Array<'markdown' | 'json' | 'junit' | 'sarif'> = formats.includes('json')
    ? formats
    : [...formats, 'json'];
  return {
    ...config,
    output: {
      ...config.output,
      format: nextFormats.length === 1 ? nextFormats[0] : nextFormats,
    },
  };
}

function buildFocusOverrides(
  focusAreas?: readonly z.infer<typeof FOCUS_MODE_ENUM>[]
): Record<string, unknown> {
  if (!focusAreas || focusAreas.length === 0) {
    return {};
  }

  const uniqueFocusAreas = [...new Set(focusAreas)];
  return {
    mission: {
      destructiveActionsAllowed: false,
      focusModes: uniqueFocusAreas,
    },
    ...(uniqueFocusAreas.includes('api') ? { apiTesting: { enabled: true } } : {}),
    ...(uniqueFocusAreas.includes('adversarial') ? { adversarial: { enabled: true } } : {}),
  };
}

function normalizeMergedConfig(
  config: Record<string, unknown>,
  context: ConfigFileContext
): LoadedDramaturgeConfig {
  return normalizeConfigPaths(ConfigSchema.parse(config), context);
}

function buildInlineBaseConfig(cwd: string, targetUrl: string): LoadedDramaturgeConfig {
  const provider = detectProviderFromEnv();
  const models = resolveProviderDefaults(provider);

  return normalizeMergedConfig(
    {
      targetUrl,
      appDescription: `Web application at ${new URL(targetUrl).hostname}`,
      auth: { type: 'none' },
      models: {
        planner: models.planner,
        worker: models.worker,
        agentMode: 'cua',
      },
      browser: {
        headless: false,
      },
      output: {
        dir: './dramaturge-reports',
        format: 'json',
        screenshots: true,
      },
    },
    {
      configPath: resolve(cwd, 'dramaturge.config.json'),
      configDir: resolve(cwd),
    }
  );
}

function buildConfigForExecution(
  deps: McpServerDependencies,
  options: {
    targetUrl: string;
    configPath?: string;
    configOverrides?: Record<string, unknown>;
    baseOverrides?: Record<string, unknown>;
  }
): LoadedDramaturgeConfig {
  if (options.configPath) {
    const loaded = deps.loadConfig(options.configPath);
    const { _meta, ...loadedConfig } = loaded;
    const merged = mergeRecords(loadedConfig, {
      targetUrl: options.targetUrl,
      ...(options.baseOverrides ?? {}),
      ...(options.configOverrides ?? {}),
    });
    return normalizeMergedConfig(merged, _meta);
  }

  const inline = buildInlineBaseConfig(deps.cwd, options.targetUrl);
  const { _meta, ...inlineConfig } = inline;
  const merged = mergeRecords(inlineConfig, {
    ...(options.baseOverrides ?? {}),
    ...(options.configOverrides ?? {}),
  });
  return normalizeMergedConfig(merged, _meta);
}

function resolveStoredRunDir(cwd: string, runId: string): string {
  const registry = readRegistry(cwd);
  const registeredDir = registry[runId]?.outputDir;
  if (registeredDir) {
    return registeredDir;
  }

  const absolute = resolve(cwd, runId);
  if (existsSync(join(absolute, 'report.json'))) {
    return absolute;
  }

  throw new Error(`Unknown Dramaturge MCP run: ${runId}`);
}

function loadRunReport(
  cwd: string,
  runId: string
): { outputDir: string; report: Record<string, unknown> } {
  const outputDir = resolveStoredRunDir(cwd, runId);
  const reportPath = join(outputDir, 'report.json');
  if (!existsSync(reportPath)) {
    throw new Error(`Run ${runId} does not contain report.json at ${reportPath}`);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as unknown;
  if (!isRecord(report)) {
    throw new Error(`Run ${runId} report.json is not a JSON object`);
  }
  return { outputDir, report };
}

function createToolResult(payload: unknown, isError = false): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function handleRunExploration(
  deps: McpServerDependencies,
  rawArgs: unknown
): Promise<McpToolResponse> {
  const args = RunExplorationArgsSchema.parse(rawArgs);
  const runId = args.runId ?? deps.generateRunId();
  const baseConfig = buildConfigForExecution(deps, {
    targetUrl: args.targetUrl,
    configPath: args.configPath,
    configOverrides: args.config,
  });
  const config = ensureJsonReport(baseConfig);
  const outputDir = join(config.output.dir, 'mcp', runId);

  await deps.runEngine(config, {
    resumeDir: outputDir,
    profile: args.profile,
    diffRef: args.diffRef,
  });

  registerRun(deps.cwd, runId, outputDir, config.targetUrl);
  const { report } = loadRunReport(deps.cwd, runId);
  return createToolResult({
    runId,
    outputDir,
    reportPath: join(outputDir, 'report.json'),
    meta: report.meta ?? null,
    summary: report.summary ?? null,
    message: 'Exploration completed. Use get_findings or get_coverage_report with this runId.',
  });
}

async function handleTestPage(
  deps: McpServerDependencies,
  rawArgs: unknown
): Promise<McpToolResponse> {
  const args = TestPageArgsSchema.parse(rawArgs);
  const runId = args.runId ?? deps.generateRunId();
  const baseOverrides = mergeRecords(buildSmokePreset() as Record<string, unknown>, {
    ...buildFocusOverrides(args.focusAreas),
  });
  const baseConfig = buildConfigForExecution(deps, {
    targetUrl: args.url,
    configPath: args.configPath,
    configOverrides: args.config,
    baseOverrides,
  });
  const config = ensureJsonReport(baseConfig);
  const outputDir = join(config.output.dir, 'mcp', runId);

  await deps.runEngine(config, {
    resumeDir: outputDir,
    profile: args.profile,
  });

  registerRun(deps.cwd, runId, outputDir, config.targetUrl);
  const { report } = loadRunReport(deps.cwd, runId);
  return createToolResult({
    runId,
    outputDir,
    reportPath: join(outputDir, 'report.json'),
    focusAreas: args.focusAreas ?? null,
    meta: report.meta ?? null,
    summary: report.summary ?? null,
    coverage: report.coverage ?? null,
  });
}

function handleGetFindings(deps: McpServerDependencies, rawArgs: unknown): McpToolResponse {
  const args = ReadRunArgsSchema.parse(rawArgs);
  const { outputDir, report } = loadRunReport(deps.cwd, args.runId);
  return createToolResult({
    runId: args.runId,
    outputDir,
    meta: report.meta ?? null,
    summary: report.summary ?? null,
    findings: report.findings ?? [],
  });
}

function handleGetCoverageReport(deps: McpServerDependencies, rawArgs: unknown): McpToolResponse {
  const args = ReadRunArgsSchema.parse(rawArgs);
  const { outputDir, report } = loadRunReport(deps.cwd, args.runId);
  return createToolResult({
    runId: args.runId,
    outputDir,
    meta: report.meta ?? null,
    summary: report.summary ?? null,
    coverage: report.coverage ?? [],
    blindSpots: report.blindSpots ?? [],
  });
}

function resolveProbeUrl(endpoint: string, baseUrl?: string): string {
  if (baseUrl) {
    return new URL(endpoint, baseUrl).href;
  }
  return new URL(endpoint).href;
}

async function handleProbeApi(
  deps: McpServerDependencies,
  rawArgs: unknown
): Promise<McpToolResponse> {
  const args = ProbeApiArgsSchema.parse(rawArgs);
  const url = resolveProbeUrl(args.endpoint, args.baseUrl);
  const requestContext = await playwrightRequest.newContext();

  try {
    const response = await replayApiRequest(requestContext, {
      url,
      method: args.method.toUpperCase(),
      headers: args.headers,
      data: args.body,
    });

    const artifact = args.specPath
      ? loadOpenApiSpec(resolve(deps.cwd, args.specPath))
      : args.spec
        ? buildOpenApiSpec(args.spec)
        : undefined;
    const contractIndex = artifact ? createContractIndex([artifact]) : undefined;
    const validation = contractIndex
      ? validateOperationResponse(
          contractIndex,
          args.method.toUpperCase(),
          new URL(url).pathname,
          response.status,
          response.body
        )
      : undefined;

    return createToolResult({
      endpoint: url,
      method: args.method.toUpperCase(),
      response,
      contractValidation: validation
        ? {
            ok: validation.ok,
            statusAllowed: validation.statusAllowed,
            errors: validation.errors,
            operation: validation.operation
              ? {
                  id: validation.operation.id,
                  method: validation.operation.method,
                  route: validation.operation.route,
                }
              : null,
          }
        : null,
    });
  } finally {
    await requestContext.dispose();
  }
}

async function dispatchToolCall(
  deps: McpServerDependencies,
  name: string,
  rawArgs: unknown
): Promise<McpToolResponse> {
  switch (name) {
    case 'run_exploration':
      return handleRunExploration(deps, rawArgs);
    case 'test_page':
      return handleTestPage(deps, rawArgs);
    case 'get_findings':
      return handleGetFindings(deps, rawArgs);
    case 'probe_api':
      return handleProbeApi(deps, rawArgs);
    case 'get_coverage_report':
      return handleGetCoverageReport(deps, rawArgs);
    default:
      return createToolResult({ message: `Unknown tool: ${name}` }, true);
  }
}

function buildSuccessResponse(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function buildErrorResponse(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

async function handleStandardRequest(
  deps: McpServerDependencies,
  request: JsonRpcRequest
): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse | undefined> {
  const requestId = request.id ?? null;

  switch (request.method) {
    case 'initialize':
      return buildSuccessResponse(requestId, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: 'dramaturge',
          version: '0.6.0',
        },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined;
    case 'ping':
      return buildSuccessResponse(requestId, {});
    case 'resources/list':
      return buildSuccessResponse(requestId, { resources: [] });
    case 'prompts/list':
      return buildSuccessResponse(requestId, { prompts: [] });
    case 'tools/list':
      return buildSuccessResponse(requestId, { tools: TOOL_DESCRIPTORS });
    case 'tools/call': {
      const params = request.params;
      if (!isRecord(params) || typeof params.name !== 'string') {
        return buildErrorResponse(requestId, -32602, 'Invalid tools/call params');
      }
      return buildSuccessResponse(
        requestId,
        await dispatchToolCall(deps, params.name, params.arguments)
      );
    }
    default:
      return buildErrorResponse(requestId, -32601, `Method not found: ${request.method}`);
  }
}

export function createDramaturgeMcpServer(
  overrides: Partial<McpServerDependencies> = {}
): DramaturgeMcpServer {
  const deps = { ...DEFAULT_MCP_DEPENDENCIES, ...overrides };

  return {
    async handleRequest(request) {
      try {
        return await handleStandardRequest(deps, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (request.method === 'tools/call') {
          return buildSuccessResponse(request.id ?? null, createToolResult({ message }, true));
        }
        return buildErrorResponse(request.id ?? null, -32000, message);
      }
    },
  };
}

function encodeMessage(message: JsonRpcSuccessResponse | JsonRpcErrorResponse): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function tryParseMessage(
  buffer: Buffer
): { message: JsonRpcRequest; remaining: Buffer } | undefined {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    return undefined;
  }

  const headerText = buffer.subarray(0, headerEnd).toString('utf8');
  const contentLengthLine = headerText
    .split('\r\n')
    .find((line) => line.toLowerCase().startsWith('content-length:'));
  if (!contentLengthLine) {
    throw new Error('Missing Content-Length header');
  }

  const contentLength = Number.parseInt(contentLengthLine.split(':')[1]?.trim() ?? '', 10);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error('Invalid Content-Length header');
  }

  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) {
    return undefined;
  }

  const rawBody = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
  return {
    message: JSON.parse(rawBody) as JsonRpcRequest,
    remaining: buffer.subarray(bodyEnd),
  };
}

export async function runMcpServer(overrides: Partial<McpServerDependencies> = {}): Promise<void> {
  const deps = { ...DEFAULT_MCP_DEPENDENCIES, ...overrides };
  const server = createDramaturgeMcpServer(deps);
  let buffer = Buffer.alloc(0) as Buffer<ArrayBufferLike>;

  for await (const chunk of deps.stdin) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (true) {
      const parsed = tryParseMessage(buffer);
      if (!parsed) {
        break;
      }
      buffer = parsed.remaining;
      const response = await server.handleRequest(parsed.message);
      if (response) {
        deps.stdout.write(encodeMessage(response));
      }
    }
  }
}
