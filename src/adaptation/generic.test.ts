// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scanGenericRepo } from './generic.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/generic-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-generic-scan-'));
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

describe('scanGenericRepo', () => {
  it('extracts useful route, selector, auth, and API hints from a non-Next repo', () => {
    const hints = scanGenericRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/settings/profile');
    expect(hints.stableSelectors).toContain('[data-testid="settings-save"]');
    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/widgets',
      methods: ['GET'],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/billing/invoices',
      methods: ['POST'],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.authHints.loginRoutes).toContain('/signin');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');
  });

  it('ignores test, fixture, and generated sources when mining hints', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, 'fixtures'), { recursive: true });
    mkdirSync(join(root, 'generated'), { recursive: true });

    writeFileSync(
      join(root, 'src', 'app.tsx'),
      [
        'export const routes = ["/dashboard"];',
        'fetch("/api/live-dashboard");',
        '<button data-testid="dashboard-refresh">Refresh</button>;',
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(
      join(root, 'tests', 'app.test.ts'),
      [
        'const mockedRoute = "/test-only";',
        'fetch("/api/test-only", { method: "POST" });',
        'screen.getByTestId("test-only-selector");',
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(
      join(root, 'fixtures', 'sample.ts'),
      'export const callback = "/oauth/callback";',
      'utf-8'
    );
    writeFileSync(
      join(root, 'generated', 'client.ts'),
      'fetch("/api/generated-client", { method: "PATCH" });',
      'utf-8'
    );

    const hints = scanGenericRepo(root);

    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).not.toContain('/test-only');
    expect(hints.authHints.callbackRoutes).not.toContain('/oauth/callback');
    expect(hints.stableSelectors).toContain('[data-testid="dashboard-refresh"]');
    expect(hints.stableSelectors).not.toContain('[data-testid="test-only-selector"]');
    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/live-dashboard',
      methods: ['GET'],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.apiEndpoints).not.toContainEqual({
      route: '/api/test-only',
      methods: ['POST'],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.apiEndpoints).not.toContainEqual({
      route: '/api/generated-client',
      methods: ['PATCH'],
      statuses: [],
      validationSchemas: [],
    });
  });
});
