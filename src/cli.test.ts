// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { buildHelpText, parseCliArgs, runCli, attachCliListeners } from './cli.js';
import { EngineEventEmitter } from './engine/event-stream.js';

describe('parseCliArgs', () => {
  it('parses run command with config and resume arguments', () => {
    expect(parseCliArgs(['run', '--config', 'custom.json', '--resume', './reports/run-1'])).toEqual(
      {
        command: 'run',
        configPath: 'custom.json',
        resumeDir: './reports/run-1',
        diffRef: undefined,
        dashboard: false,
        showHelp: false,
        url: undefined,
        login: undefined,
        headless: undefined,
        provider: undefined,
        preset: undefined,
        initTemplate: undefined,
        initOutput: undefined,
      }
    );
  });

  it('parses legacy config and resume arguments without subcommand', () => {
    expect(parseCliArgs(['--config', 'custom.json', '--resume', './reports/run-1'])).toEqual({
      command: 'run',
      configPath: 'custom.json',
      resumeDir: './reports/run-1',
      diffRef: undefined,
      dashboard: false,
      showHelp: false,
      url: undefined,
      login: undefined,
      headless: undefined,
      provider: undefined,
      preset: undefined,
      initTemplate: undefined,
      initOutput: undefined,
    });
  });

  it('detects help flags', () => {
    expect(parseCliArgs(['-h']).showHelp).toBe(true);
    expect(parseCliArgs(['--help']).showHelp).toBe(true);
  });

  it('parses --diff flag', () => {
    const result = parseCliArgs(['--diff', 'origin/main']);
    expect(result.diffRef).toBe('origin/main');
    expect(result.showHelp).toBe(false);
  });

  it('parses --diff alongside other flags', () => {
    const result = parseCliArgs(['--config', 'c.json', '--diff', 'origin/main']);
    expect(result.configPath).toBe('c.json');
    expect(result.diffRef).toBe('origin/main');
  });

  it('throws when --diff has no value', () => {
    expect(() => parseCliArgs(['--diff'])).toThrow('Missing value for --diff');
  });

  it('parses --dashboard flag', () => {
    const result = parseCliArgs(['--dashboard']);
    expect(result.dashboard).toBe(true);
    expect(result.showHelp).toBe(false);
  });

  it('parses --dashboard alongside other flags', () => {
    const result = parseCliArgs(['--config', 'c.json', '--dashboard']);
    expect(result.configPath).toBe('c.json');
    expect(result.dashboard).toBe(true);
  });

  it('defaults dashboard to false', () => {
    const result = parseCliArgs([]);
    expect(result.dashboard).toBe(false);
  });

  it('parses run with positional URL', () => {
    const result = parseCliArgs(['run', 'https://example.com']);
    expect(result.command).toBe('run');
    expect(result.url).toBe('https://example.com');
  });

  it('parses run with URL and --login flag', () => {
    const result = parseCliArgs(['run', 'https://example.com', '--login']);
    expect(result.command).toBe('run');
    expect(result.url).toBe('https://example.com');
    expect(result.login).toBe(true);
  });

  it('parses run with --headless flag', () => {
    const result = parseCliArgs(['run', 'https://example.com', '--headless']);
    expect(result.headless).toBe(true);
  });

  it('parses --provider flag', () => {
    const result = parseCliArgs(['run', 'https://example.com', '--provider', 'openai']);
    expect(result.provider).toBe('openai');
  });

  it('throws for invalid --provider', () => {
    expect(() => parseCliArgs(['run', '--provider', 'invalid'])).toThrow('Invalid provider');
  });

  it('parses --preset flag', () => {
    const result = parseCliArgs(['run', 'https://example.com', '--preset', 'smoke']);
    expect(result.preset).toBe('smoke');
  });

  it('throws for invalid --preset', () => {
    expect(() => parseCliArgs(['run', '--preset', 'invalid'])).toThrow('Invalid preset');
  });

  it('parses doctor command', () => {
    const result = parseCliArgs(['doctor']);
    expect(result.command).toBe('doctor');
  });

  it('parses init command with --template', () => {
    const result = parseCliArgs(['init', '--template', 'full']);
    expect(result.command).toBe('init');
    expect(result.initTemplate).toBe('full');
  });

  it('throws for invalid --template', () => {
    expect(() => parseCliArgs(['init', '--template', 'bad'])).toThrow('Invalid template');
  });

  it('parses setup command', () => {
    const result = parseCliArgs(['setup']);
    expect(result.command).toBe('setup');
  });

  it('parses findings list --suppressed', () => {
    const result = parseCliArgs(['findings', 'list', '--suppressed']);
    expect(result).toMatchObject({
      command: 'findings',
      triageSubcommand: 'list',
      triageSuppressedOnly: true,
    });
  });

  it('parses findings suppress with reason and positional signature', () => {
    const result = parseCliArgs(['findings', 'suppress', 'abc123', '--reason', 'known issue']);
    expect(result).toMatchObject({
      command: 'findings',
      triageSubcommand: 'suppress',
      triagePositional: ['abc123'],
      triageReason: 'known issue',
    });
  });

  it('parses baselines approve --all', () => {
    const result = parseCliArgs(['baselines', 'approve', '--all']);
    expect(result).toMatchObject({
      command: 'baselines',
      triageSubcommand: 'approve',
      triageAll: true,
    });
  });

  it('parses triage subcommand when global flags appear first', () => {
    const result = parseCliArgs(['findings', '--config', 'custom.json', 'suppress', 'abc123']);
    expect(result).toMatchObject({
      command: 'findings',
      configPath: 'custom.json',
      triageSubcommand: 'suppress',
      triagePositional: ['abc123'],
    });
  });
});

describe('buildHelpText', () => {
  it('mentions commands and run usage', () => {
    const helpText = buildHelpText();

    expect(helpText).toContain('Usage: dramaturge');
    expect(helpText).toContain('run [url]');
    expect(helpText).toContain('--config <path>');
    expect(helpText).toContain('--resume <run-dir>');
    expect(helpText).toContain('--dashboard');
    expect(helpText).toContain('both (legacy alias)');
    expect(helpText).toContain('doctor');
    expect(helpText).toContain('setup');
    expect(helpText).toContain('init');
    expect(helpText).toContain('.env');
  });
});

describe('runCli', () => {
  it('prints help without loading config', async () => {
    const output: string[] = [];
    const loadConfig = vi.fn();

    const exitCode = await runCli(['--help'], {
      loadConfig,
      runEngine: vi.fn(),
      log: (message) => {
        output.push(message);
      },
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(output.join('\n')).toContain('Usage: dramaturge');
  });

  it('loads config and runs the engine', async () => {
    const config = {
      targetUrl: 'https://example.com',
      _meta: {
        configDir: resolve('C:/tmp/dramaturge/configs'),
      },
    } as never;
    const loadConfig = vi.fn().mockReturnValue(config);
    const runEngineMock = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(['run', '--config', 'custom.json', '--resume', './run'], {
      loadConfig,
      runEngine: runEngineMock,
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(loadConfig).toHaveBeenCalledWith('custom.json');
    expect(runEngineMock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        resumeDir: resolve('C:/tmp/dramaturge/configs/run'),
      })
    );
    const passedOptions = runEngineMock.mock.calls[0][1];
    expect(passedOptions.eventStream).toBeDefined();
  });

  it('loads config with legacy args (no subcommand)', async () => {
    const config = {
      targetUrl: 'https://example.com',
      _meta: {
        configDir: resolve('C:/tmp/dramaturge/configs'),
      },
    } as never;
    const loadConfig = vi.fn().mockReturnValue(config);
    const runEngineMock = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(['--config', 'custom.json', '--resume', './run'], {
      loadConfig,
      runEngine: runEngineMock,
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(loadConfig).toHaveBeenCalledWith('custom.json');
  });

  it('builds config from inline URL when no config file', async () => {
    const runEngineMock = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(['run', 'https://example.com'], {
      loadConfig: vi.fn(),
      runEngine: runEngineMock,
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(runEngineMock).toHaveBeenCalledTimes(1);
    const passedConfig = runEngineMock.mock.calls[0][0];
    expect(passedConfig.targetUrl).toBe('https://example.com');
    expect(passedConfig.auth.type).toBe('none');
  });

  it('builds config with login flag', async () => {
    const runEngineMock = vi.fn().mockResolvedValue(undefined);

    const exitCode = await runCli(['run', 'https://example.com', '--login'], {
      loadConfig: vi.fn(),
      runEngine: runEngineMock,
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(exitCode).toBe(0);
    const passedConfig = runEngineMock.mock.calls[0][0];
    expect(passedConfig.auth.type).toBe('interactive');
  });

  it('reports errors and returns a failing exit code', async () => {
    const errors: string[] = [];

    const exitCode = await runCli(['run'], {
      loadConfig: vi.fn(() => {
        throw new Error('missing config');
      }),
      runEngine: vi.fn(),
      log: vi.fn(),
      error: (message) => {
        errors.push(message);
      },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['Error: missing config']);
  });

  it('runs doctor command', async () => {
    const output: string[] = [];

    const exitCode = await runCli(['doctor'], {
      loadConfig: vi.fn(),
      runEngine: vi.fn(),
      log: (message) => {
        output.push(message);
      },
      error: vi.fn(),
    });

    // Doctor should run and return a code
    expect(typeof exitCode).toBe('number');
    expect(output.some((m) => m.includes('Dramaturge Doctor'))).toBe(true);
  });
});

describe('attachCliListeners', () => {
  it('logs task:start events', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('task:start', {
      taskId: 't1',
      taskNumber: 1,
      nodeId: 'n1',
      workerType: 'navigation',
      objective: 'Explore home page',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[task 1]');
    expect(messages[0]).toContain('navigation');
    expect(messages[0]).toContain('Explore home page');
  });

  it('logs task:complete events', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('task:complete', {
      taskId: 't1',
      taskNumber: 1,
      nodeId: 'n1',
      outcome: 'completed',
      findingsCount: 2,
      coverageExercised: 5,
      coverageDiscovered: 10,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('completed');
    expect(messages[0]).toContain('2 finding(s)');
    expect(messages[0]).toContain('coverage: 5/10');
  });

  it('logs finding events with severity marker', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('finding', {
      taskId: 't1',
      title: 'Broken link',
      severity: 'Critical',
      category: 'Bug',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('⚠');
    expect(messages[0]).toContain('[Critical]');
    expect(messages[0]).toContain('Broken link');
  });

  it('logs state:discovered events', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('state:discovered', {
      nodeId: 'n2',
      url: 'https://example.com/about',
      pageType: 'detail',
      depth: 1,
      totalStates: 3,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('new state');
    expect(messages[0]).toContain('detail');
    expect(messages[0]).toContain('3 total');
  });

  it('logs progress events with percentage', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('progress', {
      tasksExecuted: 5,
      tasksRemaining: 10,
      totalFindings: 2,
      statesDiscovered: 4,
      elapsedMs: 30_000,
      estimatedProgress: 0.33,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('33%');
    expect(messages[0]).toContain('5 done');
    expect(messages[0]).toContain('10 queued');
  });

  it('omits coverage from task:complete when zero', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('task:complete', {
      taskId: 't1',
      taskNumber: 1,
      nodeId: 'n1',
      outcome: 'blocked',
      findingsCount: 0,
      coverageExercised: 0,
      coverageDiscovered: 0,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('coverage');
  });

  it('logs run:error events', () => {
    const emitter = new EngineEventEmitter();
    const messages: string[] = [];
    attachCliListeners(emitter, (msg) => messages.push(msg));

    emitter.emit('run:error', {
      message: 'Browser crashed',
      phase: 'engine',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Error:');
    expect(messages[0]).toContain('Browser crashed');
  });
});
