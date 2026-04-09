// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { buildExportAuthStateHelpText, parseExportAuthStateArgs } from './export-auth-state.js';

describe('parseExportAuthStateArgs', () => {
  it('parses the target url and output path', () => {
    expect(
      parseExportAuthStateArgs([
        '--url',
        'http://localhost:3000',
        '--output',
        './.dramaturge-state/user.json',
      ])
    ).toEqual({
      url: 'http://localhost:3000',
      output: './.dramaturge-state/user.json',
      successUrl: 'http://localhost:3000/',
      timeoutSeconds: 120,
      showHelp: false,
    });
  });

  it('accepts an explicit success url and timeout', () => {
    expect(
      parseExportAuthStateArgs([
        '--url',
        'https://example.com/app',
        '--output',
        './state/user.json',
        '--success-url',
        'https://example.com/dashboard',
        '--timeout-seconds',
        '180',
      ])
    ).toEqual({
      url: 'https://example.com/app',
      output: './state/user.json',
      successUrl: 'https://example.com/dashboard',
      timeoutSeconds: 180,
      showHelp: false,
    });
  });

  it('detects help flags', () => {
    expect(parseExportAuthStateArgs(['--help']).showHelp).toBe(true);
    expect(parseExportAuthStateArgs(['-h']).showHelp).toBe(true);
  });

  it('throws when required args are missing', () => {
    expect(() => parseExportAuthStateArgs(['--url', 'http://localhost:3000'])).toThrow(
      'Missing required --output'
    );
  });
});

describe('buildExportAuthStateHelpText', () => {
  it('mentions the package-local auth state helper usage', () => {
    const helpText = buildExportAuthStateHelpText();

    expect(helpText).toContain('Usage: dramaturge-auth-state');
    expect(helpText).toContain('--url <target-url>');
    expect(helpText).toContain('--output <path>');
  });
});
