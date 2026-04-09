// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canScanDjangoRepo, scanDjangoRepo } from './django.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/django-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-django-scan-'));
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

describe('canScanDjangoRepo', () => {
  it('returns true when manage.py exists', () => {
    expect(canScanDjangoRepo(fixtureRoot)).toBe(true);
  });

  it('returns false for a non-Django project', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.py'), "print('hello')", 'utf-8');
    expect(canScanDjangoRepo(root)).toBe(false);
  });
});

describe('scanDjangoRepo', () => {
  it('extracts routes from urls.py', () => {
    const hints = scanDjangoRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).toContain('/login');
    expect(hints.routes).toContain('/oauth/callback');
    expect(hints.routes).toContain('/api/users');
  });

  it('extracts route families', () => {
    const hints = scanDjangoRepo(fixtureRoot);

    expect(hints.routeFamilies).toContain('/');
    expect(hints.routeFamilies).toContain('/dashboard');
    expect(hints.routeFamilies).toContain('/api');
    expect(hints.routeFamilies).toContain('/login');
    expect(hints.routeFamilies).toContain('/oauth');
  });

  it('extracts auth hints', () => {
    const hints = scanDjangoRepo(fixtureRoot);

    expect(hints.authHints.loginRoutes).toContain('/login');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');
  });

  it('extracts selectors from HTML templates', () => {
    const hints = scanDjangoRepo(fixtureRoot);

    expect(hints.stableSelectors).toContain('[data-testid="refresh-btn"]');
    expect(hints.stableSelectors).toContain('[data-testid="user-table"]');
    expect(hints.stableSelectors).toContain('#dashboard-container');
  });

  it('detects API endpoints with DRF decorators', () => {
    const hints = scanDjangoRepo(fixtureRoot);

    expect(hints.apiEndpoints.length).toBeGreaterThan(0);
    const usersEndpoint = hints.apiEndpoints.find((ep) => ep.route === '/api/users');
    expect(usersEndpoint).toBeDefined();
    expect(usersEndpoint?.methods).toContain('GET');
    expect(usersEndpoint?.methods).toContain('POST');
  });
});
