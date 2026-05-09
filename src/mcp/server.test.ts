// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDramaturgeMcpServer, runMcpServer } from './server.js';
import type { AddressInfo } from 'node:net';
import type { DramaturgeConfig } from '../config.js';
import type { RunEngineOptions } from '../engine.js';

interface ToolCallSuccessResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result: {
    content: Array<{
      type: 'text';
      text: string;
    }>;
    isError?: boolean;
  };
}

function extractToolPayload(response: unknown): Record<string, unknown> {
  if (!isRecord(response)) {
    throw new Error('Response is not an object');
  }
  const result = response.result;
  if (!isRecord(result)) {
    throw new Error('Tool response is missing a result');
  }
  const content = result.content;
  if (!Array.isArray(content) || !isRecord(content[0]) || typeof content[0].text !== 'string') {
    throw new Error('Tool response is missing text content');
  }
  const payload = JSON.parse(content[0].text) as unknown;
  if (!isRecord(payload)) {
    throw new Error('Tool payload is not an object');
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Encode a JSON-RPC message with Content-Length framing (used in stdio MCP transport). */
function frame(message: Record<string, unknown>): Buffer {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  return Buffer.from(header + body, 'utf8');
}

describe('createDramaturgeMcpServer', () => {
  let testDir: string;
  let apiServer: Server | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-mcp-'));
  });

  afterEach(async () => {
    if (apiServer) {
      await new Promise<void>((resolve, reject) => {
        apiServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      apiServer = undefined;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('lists the Dramaturge MCP tools during initialization', async () => {
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    const initializeResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    const toolsResponse = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    expect(initializeResponse).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dramaturge' },
      },
    });
    expect(toolsResponse).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'run_exploration' }),
          expect.objectContaining({ name: 'test_page' }),
          expect.objectContaining({ name: 'get_findings' }),
          expect.objectContaining({ name: 'probe_api' }),
          expect.objectContaining({ name: 'get_coverage_report' }),
        ]),
      },
    });
  });

  it('runs an exploration and reloads findings by runId', async () => {
    const runEngine = vi.fn(
      async (config: DramaturgeConfig, options?: RunEngineOptions): Promise<void> => {
        mkdirSync(options?.resumeDir ?? '', { recursive: true });
        writeFileSync(
          join(options?.resumeDir ?? '', 'report.json'),
          JSON.stringify({
            meta: { targetUrl: config.targetUrl },
            summary: { totalFindings: 1 },
            findings: [{ id: 'finding-1', title: 'Broken link' }],
            coverage: [{ name: 'Home', findings: 1 }],
            blindSpots: [],
          }),
          'utf-8'
        );
      }
    );
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine,
      generateRunId: () => 'run-123',
    });

    const runResponse = (await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'run_exploration',
        arguments: {
          targetUrl: 'https://example.com',
        },
      },
    })) as ToolCallSuccessResponse;
    const findingsResponse = (await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_findings',
        arguments: {
          runId: 'run-123',
        },
      },
    })) as ToolCallSuccessResponse;

    expect(runEngine).toHaveBeenCalledTimes(1);
    const [passedConfig, passedOptions] = vi.mocked(runEngine).mock.calls[0] ?? [];
    expect(passedConfig?.targetUrl).toBe('https://example.com');
    expect(passedConfig?.output.format).toBe('json');
    expect(passedOptions?.resumeDir).toBe(join(testDir, 'dramaturge-reports', 'mcp', 'run-123'));

    const runPayload = extractToolPayload(runResponse);
    const findingsPayload = extractToolPayload(findingsResponse);
    expect(runPayload.runId).toBe('run-123');
    expect(findingsPayload.findings).toEqual([{ id: 'finding-1', title: 'Broken link' }]);
    expect(readFileSync(join(testDir, '.dramaturge', 'mcp-runs.json'), 'utf-8')).toContain(
      'run-123'
    );
  });

  it('applies smoke defaults and focus-area overrides for test_page', async () => {
    const runEngine = vi.fn(
      async (_config: DramaturgeConfig, options?: RunEngineOptions): Promise<void> => {
        mkdirSync(options?.resumeDir ?? '', { recursive: true });
        writeFileSync(
          join(options?.resumeDir ?? '', 'report.json'),
          JSON.stringify({
            meta: { targetUrl: 'https://example.com/settings' },
            summary: { totalFindings: 0 },
            findings: [],
            coverage: [],
            blindSpots: [],
          }),
          'utf-8'
        );
      }
    );
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine,
      generateRunId: () => 'page-run',
    });

    await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'test_page',
        arguments: {
          url: 'https://example.com/settings',
          focusAreas: ['navigation', 'api'],
        },
      },
    });

    const [passedConfig] = vi.mocked(runEngine).mock.calls[0] ?? [];
    expect(passedConfig?.budget.globalTimeLimitSeconds).toBe(180);
    expect(passedConfig?.mission?.focusModes).toEqual(['navigation', 'api']);
    expect(passedConfig?.apiTesting.enabled).toBe(true);
  });

  it('replays probe_api requests and validates the response against a provided spec', async () => {
    apiServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => {
      apiServer?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = apiServer.address() as AddressInfo;
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    const probeResponse = (await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'probe_api',
        arguments: {
          endpoint: '/health',
          baseUrl: `http://127.0.0.1:${address.port}`,
          spec: {
            openapi: '3.1.0',
            info: { title: 'Health API', version: '1.0.0' },
            paths: {
              '/health': {
                get: {
                  responses: {
                    '200': {
                      description: 'OK',
                      content: {
                        'application/json': {
                          schema: {
                            type: 'object',
                            required: ['ok'],
                            properties: {
                              ok: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })) as ToolCallSuccessResponse;

    const probePayload = extractToolPayload(probeResponse);
    expect(probePayload.endpoint).toBe(`http://127.0.0.1:${address.port}/health`);
    expect(probePayload.contractValidation).toMatchObject({
      ok: true,
      statusAllowed: true,
      errors: [],
    });
    expect(probePayload.response).toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });

  it('returns a validation error from probe_api when endpoint is relative and baseUrl is absent', async () => {
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'probe_api',
        arguments: {
          endpoint: '/health',
        },
      },
    });

    expect(isRecord(response)).toBe(true);
    expect(isRecord(response) && isRecord(response.result)).toBe(true);
    if (isRecord(response) && isRecord(response.result)) {
      expect(response.result.isError).toBe(true);
      const content = response.result.content;
      const text = Array.isArray(content) && isRecord(content[0]) ? content[0].text : '';
      expect(typeof text === 'string' && text).toContain('absolute URL');
    }
  });

  it('rejects unknown fields in run_exploration arguments', async () => {
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'run_exploration',
        arguments: {
          targetUrl: 'https://example.com',
          unknownField: true,
        },
      },
    });

    expect(isRecord(response) && isRecord(response.result)).toBe(true);
    if (isRecord(response) && isRecord(response.result)) {
      expect(response.result.isError).toBe(true);
    }
  });

  it('does not reply to MCP notifications (requests without id)', async () => {
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    const notificationResponse = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    const unknownNotificationResponse = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/custom',
    });

    expect(notificationResponse).toBeUndefined();
    expect(unknownNotificationResponse).toBeUndefined();
  });

  it('reads an empty registry when the registry file is corrupted', async () => {
    const registryPath = join(testDir, '.dramaturge', 'mcp-runs.json');
    mkdirSync(join(testDir, '.dramaturge'), { recursive: true });
    writeFileSync(registryPath, 'CORRUPTED JSON {{{{', 'utf-8');

    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    // get_findings against an unknown runId should throw a clear error, not JSON.parse crash
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_findings',
        arguments: { runId: 'run-does-not-exist' },
      },
    });

    expect(isRecord(response) && isRecord(response.result)).toBe(true);
    if (isRecord(response) && isRecord(response.result)) {
      expect(response.result.isError).toBe(true);
      const content = response.result.content;
      const text = Array.isArray(content) && isRecord(content[0]) ? content[0].text : '';
      // Should report unknown run, not a JSON syntax error
      expect(typeof text === 'string' && text).toContain('Unknown Dramaturge MCP run');
    }
  });

  it('sources version from package.json in the initialize response', async () => {
    const server = createDramaturgeMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
    });

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });

    expect(isRecord(response) && isRecord(response.result)).toBe(true);
    if (isRecord(response) && isRecord(response.result)) {
      const info = response.result.serverInfo;
      expect(isRecord(info) && typeof info.version).toBe('string');
      if (isRecord(info)) {
        expect(String(info.version)).toMatch(/^\d+\.\d+\.\d+/);
      }
    }
  });
});

describe('runMcpServer — stdio framing', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'dramaturge-mcp-stdio-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('handles two back-to-back messages sent in one chunk', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on('data', (c: Buffer) => chunks.push(c));

    const serverDone = runMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
      stdin,
      stdout,
      stderr: new PassThrough(),
      generateRunId: () => 'test-run',
    });

    // Concatenate two messages and send in one write
    const combined = Buffer.concat([
      frame({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      frame({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    ]);
    stdin.write(combined);
    stdin.end();

    await serverDone;

    const output = Buffer.concat(chunks).toString('utf8');
    // Should contain both responses
    expect(output).toContain('"id":1');
    expect(output).toContain('"protocolVersion"');
    expect(output).toContain('"id":2');
    expect(output).toContain('"run_exploration"');
  });

  it('assembles a single message split across multiple chunks', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on('data', (c: Buffer) => chunks.push(c));

    const serverDone = runMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
      stdin,
      stdout,
      stderr: new PassThrough(),
      generateRunId: () => 'test-run',
    });

    const full = frame({ jsonrpc: '2.0', id: 1, method: 'ping' });
    // Split between header and body
    const splitAt = full.indexOf('\r\n\r\n') + 2;
    stdin.write(full.subarray(0, splitAt));
    stdin.write(full.subarray(splitAt));
    stdin.end();

    await serverDone;

    const output = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(output.slice(output.indexOf('{'))) as unknown;
    expect(isRecord(parsed)).toBe(true);
    if (isRecord(parsed)) {
      expect(parsed.id).toBe(1);
      expect(isRecord(parsed.result)).toBe(true);
    }
  });

  it('does not write any output for a notification sent over stdio', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on('data', (c: Buffer) => chunks.push(c));

    const serverDone = runMcpServer({
      cwd: testDir,
      runEngine: vi.fn(),
      stdin,
      stdout,
      stderr: new PassThrough(),
      generateRunId: () => 'test-run',
    });

    stdin.write(frame({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    stdin.end();

    await serverDone;

    expect(chunks).toHaveLength(0);
  });
});
