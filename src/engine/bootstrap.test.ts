import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  startBootstrapProcess,
  stopBootstrapProcess,
  waitForBootstrapReady,
} from "./bootstrap.js";

function createMockProcess() {
  const processRef = new EventEmitter() as any;
  processRef.pid = 4321;
  processRef.stdout = new PassThrough();
  processRef.stderr = new PassThrough();
  processRef.kill = vi.fn();
  return processRef;
}

function createResponse(status: number, ok = status >= 200 && status < 300) {
  return {
    status,
    ok,
  };
}

describe("bootstrap supervision", () => {
  it("fails fast when the bootstrap process exits before the app is ready", async () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn().mockReturnValue(processRef);

    const status = startBootstrapProcess(
      {
        bootstrap: {
          command: "pnpm dev",
          cwd: "C:/tmp/app",
        },
      } as any,
      spawnImpl as any
    )!;

    processRef.stderr.write("server crashed\n");
    processRef.emit("exit", 1, null);

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: "https://example.com",
          bootstrap: {
            command: "pnpm dev",
            readyUrl: "/health",
            timeoutSeconds: 5,
          },
        } as any,
        {
          goto: vi.fn(),
          evaluate: vi.fn(),
        } as any,
        status,
        {
          fetchImpl: vi.fn().mockResolvedValue(createResponse(503, false)) as any,
          sleep: async () => {},
          now: () => 0,
        }
      )
    ).rejects.toThrow(/Bootstrap process exited before ready/);

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: "https://example.com",
          bootstrap: {
            command: "pnpm dev",
            readyUrl: "/health",
            timeoutSeconds: 5,
          },
        } as any,
        {
          goto: vi.fn(),
          evaluate: vi.fn(),
        } as any,
        status,
        {
          fetchImpl: vi.fn().mockResolvedValue(createResponse(503, false)) as any,
          sleep: async () => {},
          now: () => 0,
        }
      )
    ).rejects.toThrow(/server crashed/);
  });

  it("times out a hanging ready-url fetch instead of waiting forever", async () => {
    let nowMs = 0;

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: "https://example.com",
          bootstrap: {
            readyUrl: "/health",
            timeoutSeconds: 1,
          },
        } as any,
        {
          goto: vi.fn(),
          evaluate: vi.fn(),
        } as any,
        undefined,
        {
          requestTimeoutMs: 5,
          fetchImpl: vi.fn((_url: string, init?: RequestInit) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new Error("aborted"));
              });
            })
          ) as any,
          sleep: async () => {
            nowMs += 1000;
          },
          now: () => nowMs,
        }
      )
    ).rejects.toThrow(/did not become ready within 1s/);
  });

  it("times out when the ready indicator never appears", async () => {
    let nowMs = 0;
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(false),
    };

    await expect(
      waitForBootstrapReady(
        {
          targetUrl: "https://example.com",
          bootstrap: {
            readyUrl: "/health",
            readyIndicator: "#app-ready",
            timeoutSeconds: 1,
          },
        } as any,
        page as any,
        undefined,
        {
          fetchImpl: vi.fn().mockResolvedValue(createResponse(200, true)) as any,
          sleep: async () => {
            nowMs += 1000;
          },
          now: () => nowMs,
        }
      )
    ).rejects.toThrow(/did not become ready within 1s/);

    expect(page.goto).toHaveBeenCalledWith("https://example.com/health");
    expect(page.evaluate).toHaveBeenCalled();
  });

  it("uses taskkill on Windows and kill on other platforms during cleanup", () => {
    const processRef = createMockProcess();
    const spawnImpl = vi.fn();

    stopBootstrapProcess(
      { process: processRef } as any,
      spawnImpl as any,
      "win32"
    );
    expect(spawnImpl).toHaveBeenCalledWith("taskkill", ["/pid", "4321", "/t", "/f"], {
      stdio: "ignore",
    });

    stopBootstrapProcess(
      { process: processRef } as any,
      spawnImpl as any,
      "linux"
    );
    expect(processRef.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
