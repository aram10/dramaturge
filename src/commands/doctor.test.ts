// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDoctorChecks, printDoctorResults, runDoctor } from './doctor.js';
import type { DoctorCheckResult, DoctorDependencies } from './doctor.js';

describe('runDoctorChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an array of check results', () => {
    const results = runDoctorChecks(process.cwd());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const check of results) {
      expect(check).toHaveProperty('label');
      expect(check).toHaveProperty('ok');
      expect(check).toHaveProperty('message');
    }
  });

  it('includes Node.js version check', () => {
    const results = runDoctorChecks(process.cwd());
    const nodeCheck = results.find((r) => r.label === 'Node.js version');
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.ok).toBe(true);
  });

  it('includes LLM API key check', () => {
    const results = runDoctorChecks(process.cwd());
    const apiCheck = results.find((r) => r.label === 'LLM API key');
    expect(apiCheck).toBeDefined();
  });

  it('includes config file check', () => {
    const results = runDoctorChecks(process.cwd());
    const configCheck = results.find((r) => r.label === 'Config file');
    expect(configCheck).toBeDefined();
  });

  it('includes output directory check', () => {
    const results = runDoctorChecks(process.cwd());
    const outputCheck = results.find((r) => r.label === 'Output directory');
    expect(outputCheck).toBeDefined();
    expect(outputCheck!.ok).toBe(true);
  });
});

describe('printDoctorResults', () => {
  it('prints results with check marks', () => {
    const messages: string[] = [];
    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
    };

    const results: DoctorCheckResult[] = [{ label: 'Test check', ok: true, message: 'All good' }];

    const allOk = printDoctorResults(results, deps);
    expect(allOk).toBe(true);
    expect(messages.some((m) => m.includes('✓'))).toBe(true);
    expect(messages.some((m) => m.includes('All checks passed'))).toBe(true);
  });

  it('prints failed checks with fix suggestions', () => {
    const messages: string[] = [];
    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
    };

    const results: DoctorCheckResult[] = [
      { label: 'Failed check', ok: false, message: 'Not found', fix: 'Run some command' },
    ];

    const allOk = printDoctorResults(results, deps);
    expect(allOk).toBe(false);
    expect(messages.some((m) => m.includes('✗'))).toBe(true);
    expect(messages.some((m) => m.includes('Fix:'))).toBe(true);
    expect(messages.some((m) => m.includes('Some checks failed'))).toBe(true);
  });
});

describe('runDoctor', () => {
  it('returns 0 or 1 based on checks', () => {
    const messages: string[] = [];
    const deps: DoctorDependencies = {
      log: (msg) => messages.push(msg),
      cwd: process.cwd(),
    };

    const exitCode = runDoctor(deps);
    expect(typeof exitCode).toBe('number');
    expect(exitCode === 0 || exitCode === 1).toBe(true);
    expect(messages.some((m) => m.includes('Dramaturge Doctor'))).toBe(true);
  });
});
