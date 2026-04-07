import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canScanExpressRepo, scanExpressRepo } from './express.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/express-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-express-scan-'));
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

describe('canScanExpressRepo', () => {
  it('returns true when a source file imports express', () => {
    expect(canScanExpressRepo(fixtureRoot)).toBe(true);
  });

  it('returns false for an empty project', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), "console.log('hello');", 'utf-8');
    expect(canScanExpressRepo(root)).toBe(false);
  });
});

describe('scanExpressRepo', () => {
  it('extracts routes, API endpoints, auth hints, selectors, and expected HTTP noise', () => {
    const hints = scanExpressRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).toContain('/login');
    expect(hints.routes).toContain('/oauth/callback');
    expect(hints.routes).toContain('/api/users');
    expect(hints.routes).toContain('/api/users/:id');

    expect(hints.routeFamilies).toContain('/');
    expect(hints.routeFamilies).toContain('/dashboard');
    expect(hints.routeFamilies).toContain('/api');
    expect(hints.routeFamilies).toContain('/login');
    expect(hints.routeFamilies).toContain('/oauth');

    expect(hints.stableSelectors).toContain('[data-testid="dashboard-main"]');
    expect(hints.stableSelectors).toContain('#home-hero');

    expect(hints.apiEndpoints).toContainEqual(
      expect.objectContaining({
        route: '/api/users',
        methods: expect.arrayContaining(['GET', 'POST']),
      })
    );

    expect(hints.authHints.loginRoutes).toContain('/login');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');

    expect(hints.expectedHttpNoise.length).toBeGreaterThan(0);
  });

  it('produces correct route families', () => {
    const hints = scanExpressRepo(fixtureRoot);

    for (const family of hints.routeFamilies) {
      expect(family).toMatch(/^\/[a-z-]*$/i);
    }
  });
});
