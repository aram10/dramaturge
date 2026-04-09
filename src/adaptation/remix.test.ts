// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canScanRemixRepo, scanRemixRepo } from './remix.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/remix-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-remix-scan-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('canScanRemixRepo', () => {
  it('returns true when @remix-run/ imports are present', () => {
    expect(canScanRemixRepo(fixtureRoot)).toBe(true);
  });

  it('returns false for a non-Remix project', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), "console.log('hello')", 'utf-8');
    expect(canScanRemixRepo(root)).toBe(false);
  });
});

describe('scanRemixRepo', () => {
  it('extracts routes from app/routes', () => {
    const hints = scanRemixRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).toContain('/login');
    expect(hints.routes).toContain('/oauth/callback');
    expect(hints.routes).toContain('/api/users');
    expect(hints.routes).toContain('/api/users/:id');
  });

  it('extracts route families', () => {
    const hints = scanRemixRepo(fixtureRoot);

    expect(hints.routeFamilies).toContain('/');
    expect(hints.routeFamilies).toContain('/dashboard');
    expect(hints.routeFamilies).toContain('/api');
    expect(hints.routeFamilies).toContain('/login');
    expect(hints.routeFamilies).toContain('/oauth');
  });

  it('extracts auth hints', () => {
    const hints = scanRemixRepo(fixtureRoot);

    expect(hints.authHints.loginRoutes).toContain('/login');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');
  });

  it('extracts selectors from JSX content', () => {
    const hints = scanRemixRepo(fixtureRoot);

    expect(hints.stableSelectors).toContain('[data-testid="app-nav"]');
    expect(hints.stableSelectors).toContain('[data-testid="dashboard-main"]');
    expect(hints.stableSelectors).toContain('#home-hero');
  });

  it('detects API endpoints from resource routes', () => {
    const hints = scanRemixRepo(fixtureRoot);

    expect(hints.apiEndpoints.length).toBeGreaterThan(0);
    const usersEndpoint = hints.apiEndpoints.find((ep) => ep.route === '/api/users');
    expect(usersEndpoint).toBeDefined();
    expect(usersEndpoint?.methods).toContain('GET');
    expect(usersEndpoint?.methods).toContain('POST');
  });

  it('extracts expected HTTP noise for auth-guarded routes', () => {
    const hints = scanRemixRepo(fixtureRoot);

    expect(hints.expectedHttpNoise.length).toBeGreaterThan(0);
    const usersNoise = hints.expectedHttpNoise.find((n) => n.pathPrefix === '/api/users');
    expect(usersNoise).toBeDefined();
    expect(usersNoise?.statuses).toContain(401);
    expect(usersNoise?.statuses).toContain(403);
  });
});
