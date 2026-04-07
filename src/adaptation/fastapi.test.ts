import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { canScanFastApiRepo, scanFastApiRepo } from './fastapi.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/fastapi-app', import.meta.url));
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-fastapi-scan-'));
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

describe('canScanFastApiRepo', () => {
  it('returns true for a FastAPI project', () => {
    expect(canScanFastApiRepo(fixtureRoot)).toBe(true);
  });

  it('returns false for an empty project', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.py'), "print('hello')", 'utf-8');
    expect(canScanFastApiRepo(root)).toBe(false);
  });
});

describe('scanFastApiRepo', () => {
  it('extracts routes from FastAPI decorators', () => {
    const hints = scanFastApiRepo(fixtureRoot);

    expect(hints.routes).toContain('/');
    expect(hints.routes).toContain('/dashboard');
    expect(hints.routes).toContain('/login');
    expect(hints.routes).toContain('/oauth/callback');
    expect(hints.routes).toContain('/api/users');
    expect(hints.routes).toContain('/api/users/:user_id');
  });

  it('extracts route families', () => {
    const hints = scanFastApiRepo(fixtureRoot);

    expect(hints.routeFamilies).toContain('/');
    expect(hints.routeFamilies).toContain('/dashboard');
    expect(hints.routeFamilies).toContain('/api');
    expect(hints.routeFamilies).toContain('/login');
    expect(hints.routeFamilies).toContain('/oauth');
  });

  it('extracts auth hints', () => {
    const hints = scanFastApiRepo(fixtureRoot);

    expect(hints.authHints.loginRoutes).toContain('/login');
    expect(hints.authHints.callbackRoutes).toContain('/oauth/callback');
  });

  it('extracts selectors from HTML templates', () => {
    const hints = scanFastApiRepo(fixtureRoot);

    expect(hints.stableSelectors).toContain('[data-testid="dashboard-panel"]');
    expect(hints.stableSelectors).toContain('[data-testid="refresh-btn"]');
    expect(hints.stableSelectors).toContain('#dashboard-container');
  });

  it('detects API endpoints with methods', () => {
    const hints = scanFastApiRepo(fixtureRoot);

    expect(hints.apiEndpoints.length).toBeGreaterThan(0);
    const usersEndpoint = hints.apiEndpoints.find((ep) => ep.route === '/api/users');
    expect(usersEndpoint).toBeDefined();
    expect(usersEndpoint?.methods).toContain('GET');
    expect(usersEndpoint?.methods).toContain('POST');
  });

  it('detects expected HTTP noise for auth-guarded routes', () => {
    const hints = scanFastApiRepo(fixtureRoot);

    expect(hints.expectedHttpNoise.length).toBeGreaterThan(0);
    const usersNoise = hints.expectedHttpNoise.find((n) => n.pathPrefix === '/api/users');
    expect(usersNoise).toBeDefined();
    expect(usersNoise?.statuses).toContain(401);
    expect(usersNoise?.statuses).toContain(403);
  });
});
