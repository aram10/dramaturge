import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canScanVueRouterRepo, scanVueRouterRepo } from './vue-router.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/vue-router-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-vue-router-scan-'));
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

describe('canScanVueRouterRepo', () => {
  it('returns true when a source file imports from vue-router', () => {
    expect(canScanVueRouterRepo(fixtureRoot)).toBe(true);
  });

  it('returns true when a source file calls createRouter', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'router.ts'),
      [
        'const router = createRouter({',
        '  history: createWebHistory(),',
        '  routes: [],',
        '});',
      ].join('\n'),
      'utf-8'
    );
    expect(canScanVueRouterRepo(root)).toBe(true);
  });

  it('returns false when no vue-router imports or createRouter calls exist', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'app.ts'),
      'import { createApp } from "vue";\nexport default createApp({});',
      'utf-8'
    );
    expect(canScanVueRouterRepo(root)).toBe(false);
  });
});

describe('scanVueRouterRepo', () => {
  it('extracts routes from createRouter config objects', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).toContain('/settings');
    expect(hints.routes).toContain('/users/:id');
  });

  it('extracts routes from <router-link> elements in .vue files', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.routes).toContain('/about');
    expect(hints.routes).toContain('/contact');
  });

  it('computes route families', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.routeFamilies).toContain('/');
    expect(hints.routeFamilies).toContain('/dashboard');
    expect(hints.routeFamilies).toContain('/settings');
    expect(hints.routeFamilies).toContain('/about');
    expect(hints.routeFamilies).toContain('/users');
  });

  it('extracts stable selectors (data-testid and id)', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.stableSelectors).toContain('[data-testid="refresh-btn"]');
    expect(hints.stableSelectors).toContain('[data-testid="status-indicator"]');
    expect(hints.stableSelectors).toContain('#dashboard-root');
  });

  it('extracts API endpoints from fetch() calls', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/widgets',
      methods: ['GET'],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/items',
      methods: ['POST'],
      statuses: [],
      validationSchemas: [],
    });
  });

  it('extracts API endpoints from axios calls', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/users',
      methods: ['GET'],
      statuses: [],
      validationSchemas: [],
    });
  });

  it('detects auth hints from route paths', () => {
    const hints = scanVueRouterRepo(fixtureRoot);

    expect(hints.authHints.loginRoutes).toContain('/login');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');
  });

  it('ignores test, fixture, and generated source directories', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, 'generated'), { recursive: true });

    writeFileSync(
      join(root, 'src', 'router.ts'),
      [
        'import { createRouter } from "vue-router";',
        'export const router = createRouter({',
        '  routes: [',
        '    { path: "/real-route" },',
        '  ],',
        '});',
        '<button data-testid="real-btn">Go</button>;',
        'fetch("/api/real-endpoint");',
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(
      join(root, 'tests', 'router.test.ts'),
      [
        'const testRoute = { path: "/test-only" };',
        'fetch("/api/test-only");',
        '<button data-testid="test-only-btn">Test</button>;',
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(join(root, 'generated', 'routes.ts'), '{ path: "/generated-route" }', 'utf-8');

    const hints = scanVueRouterRepo(root);

    expect(hints.routes).toContain('/real-route');
    expect(hints.routes).not.toContain('/test-only');
    expect(hints.routes).not.toContain('/generated-route');
    expect(hints.stableSelectors).toContain('[data-testid="real-btn"]');
    expect(hints.stableSelectors).not.toContain('[data-testid="test-only-btn"]');
    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/real-endpoint',
      methods: ['GET'],
      statuses: [],
      validationSchemas: [],
    });
    expect(hints.apiEndpoints).not.toContainEqual(
      expect.objectContaining({ route: '/api/test-only' })
    );
  });
});
