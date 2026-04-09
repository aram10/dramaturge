// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canScanAstroRepo, scanAstroRepo } from './astro.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/astro-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-astro-scan-'));
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

describe('canScanAstroRepo', () => {
  it('returns true when astro.config.mjs exists', () => {
    expect(canScanAstroRepo(fixtureRoot)).toBe(true);
  });

  it('returns false for a non-Astro project', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), "console.log('hello')", 'utf-8');
    expect(canScanAstroRepo(root)).toBe(false);
  });
});

describe('scanAstroRepo', () => {
  it('extracts routes from src/pages', () => {
    const hints = scanAstroRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).toContain('/login');
    expect(hints.routes).toContain('/oauth/callback');
    expect(hints.routes).toContain('/api/users');
    expect(hints.routes).toContain('/api/users/:id');
  });

  it('extracts route families', () => {
    const hints = scanAstroRepo(fixtureRoot);

    expect(hints.routeFamilies).toContain('/');
    expect(hints.routeFamilies).toContain('/dashboard');
    expect(hints.routeFamilies).toContain('/api');
    expect(hints.routeFamilies).toContain('/login');
    expect(hints.routeFamilies).toContain('/oauth');
  });

  it('extracts auth hints', () => {
    const hints = scanAstroRepo(fixtureRoot);

    expect(hints.authHints.loginRoutes).toContain('/login');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');
  });

  it('extracts selectors from .astro files', () => {
    const hints = scanAstroRepo(fixtureRoot);

    expect(hints.stableSelectors).toContain('[data-testid="login-form"]');
    expect(hints.stableSelectors).toContain('[data-testid="dashboard-main"]');
    expect(hints.stableSelectors).toContain('[data-testid="app-nav"]');
    expect(hints.stableSelectors).toContain('#home-hero');
  });

  it('detects API endpoints with methods', () => {
    const hints = scanAstroRepo(fixtureRoot);

    expect(hints.apiEndpoints.length).toBeGreaterThan(0);

    const usersEndpoint = hints.apiEndpoints.find((ep) => ep.route === '/api/users');
    expect(usersEndpoint).toBeDefined();
    expect(usersEndpoint?.methods).toContain('GET');
    expect(usersEndpoint?.methods).toContain('POST');

    const userByIdEndpoint = hints.apiEndpoints.find((ep) => ep.route === '/api/users/:id');
    expect(userByIdEndpoint).toBeDefined();
    expect(userByIdEndpoint?.methods).toContain('GET');
    expect(userByIdEndpoint?.methods).toContain('DELETE');
  });

  it('extracts expected HTTP noise', () => {
    const hints = scanAstroRepo(fixtureRoot);

    expect(hints.expectedHttpNoise.length).toBeGreaterThan(0);
    const usersNoise = hints.expectedHttpNoise.find((n) => n.pathPrefix === '/api/users');
    expect(usersNoise).toBeDefined();
    expect(usersNoise?.statuses).toContain(401);
    expect(usersNoise?.statuses).toContain(403);
  });
});
