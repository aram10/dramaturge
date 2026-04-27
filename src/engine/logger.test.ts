// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineEventEmitter } from './event-stream.js';
import { createEngineLogger } from './logger.js';

describe('createEngineLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes structured info logs and emits log events', () => {
    const emitter = new EngineEventEmitter();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const events: Array<{ level: string; scope: string; message: string }> = [];
    emitter.on('log', (event) => events.push(event));

    const logger = createEngineLogger(emitter, 'engine');
    logger.info('Started', { taskCount: 3 });

    expect(infoSpy).toHaveBeenCalledWith('[dramaturge:engine] Started {"taskCount":3}');
    expect(events).toEqual([
      {
        level: 'info',
        scope: 'engine',
        message: 'Started',
        context: { taskCount: 3 },
      },
    ]);
  });

  it('creates child scopes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const logger = createEngineLogger(undefined, 'engine').child('bootstrap');
    logger.warn('Waiting', { attempt: 2 });

    expect(warnSpy).toHaveBeenCalledWith('[dramaturge:engine.bootstrap] Waiting {"attempt":2}');
  });
});
