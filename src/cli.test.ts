import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { buildHelpText, parseCliArgs, runCli } from "./cli.js";

describe("parseCliArgs", () => {
  it("parses config and resume arguments", () => {
    expect(
      parseCliArgs(["--config", "custom.json", "--resume", "./reports/run-1"])
    ).toEqual({
      configPath: "custom.json",
      resumeDir: "./reports/run-1",
      showHelp: false,
    });
  });

  it("detects help flags", () => {
    expect(parseCliArgs(["-h"]).showHelp).toBe(true);
    expect(parseCliArgs(["--help"]).showHelp).toBe(true);
  });
});

describe("buildHelpText", () => {
  it("mentions config and resume usage", () => {
    const helpText = buildHelpText();

    expect(helpText).toContain("Usage: dramaturge");
    expect(helpText).toContain("--config <path>");
    expect(helpText).toContain("--resume <run-dir>");
  });
});

describe("runCli", () => {
  it("prints help without loading config", async () => {
    const output: string[] = [];
    const loadConfig = vi.fn();

    const exitCode = await runCli(["--help"], {
      loadConfig,
      runEngine: vi.fn(),
      log: (message) => {
        output.push(message);
      },
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain("Usage: dramaturge");
  });

  it("loads config and runs the engine", async () => {
    const config = {
      targetUrl: "https://example.com",
      _meta: {
        configDir: resolve("C:/tmp/dramaturge/configs"),
      },
    } as never;
    const loadConfig = vi.fn().mockReturnValue(config);
    const runEngineMock = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(["--config", "custom.json", "--resume", "./run"], {
      loadConfig,
      runEngine: runEngineMock,
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(loadConfig).toHaveBeenCalledWith("custom.json");
    expect(runEngineMock).toHaveBeenCalledWith(config, {
      resumeDir: resolve("C:/tmp/dramaturge/configs/run"),
    });
  });

  it("reports errors and returns a failing exit code", async () => {
    const errors: string[] = [];

    const exitCode = await runCli([], {
      loadConfig: vi.fn(() => {
        throw new Error("missing config");
      }),
      runEngine: vi.fn(),
      log: vi.fn(),
      error: (message) => {
        errors.push(message);
      },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["Error: missing config"]);
  });
});
