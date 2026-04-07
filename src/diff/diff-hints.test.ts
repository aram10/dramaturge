import { describe, it, expect } from 'vitest';
import { buildDiffContextFromFiles, isNodeAffectedByDiff } from './diff-hints.js';
import type { DiffFileEntry } from './types.js';
import type { RepoHints } from '../adaptation/types.js';

function makeRepoHints(overrides: Partial<RepoHints> = {}): RepoHints {
  return {
    routes: [],
    routeFamilies: [],
    stableSelectors: [],
    apiEndpoints: [],
    authHints: { loginRoutes: [], callbackRoutes: [] },
    expectedHttpNoise: [],
    ...overrides,
  };
}

describe('buildDiffContextFromFiles', () => {
  it('returns empty context when no files changed', () => {
    const ctx = buildDiffContextFromFiles(
      'origin/main',
      [],
      makeRepoHints({ routes: ['/dashboard', '/users'] })
    );

    expect(ctx.baseRef).toBe('origin/main');
    expect(ctx.changedFiles).toEqual([]);
    expect(ctx.affectedRoutes).toEqual([]);
    expect(ctx.affectedApiEndpoints).toEqual([]);
  });

  it('returns empty affected arrays when no repo hints provided', () => {
    const files: DiffFileEntry[] = [{ path: 'src/pages/dashboard/index.tsx', status: 'modified' }];
    const ctx = buildDiffContextFromFiles('origin/main', files);

    expect(ctx.changedFiles).toHaveLength(1);
    expect(ctx.affectedRoutes).toEqual([]);
  });

  it('matches changed files to routes', () => {
    const files: DiffFileEntry[] = [
      { path: 'src/pages/dashboard/index.tsx', status: 'modified' },
      { path: 'src/components/header.tsx', status: 'modified' },
    ];
    const hints = makeRepoHints({
      routes: ['/dashboard', '/users', '/settings'],
    });

    const ctx = buildDiffContextFromFiles('origin/main', files, hints);

    expect(ctx.affectedRoutes).toContain('/dashboard');
    expect(ctx.affectedRoutes).not.toContain('/settings');
  });

  it('matches changed files to API endpoints', () => {
    const files: DiffFileEntry[] = [{ path: 'src/api/users/route.ts', status: 'modified' }];
    const hints = makeRepoHints({
      apiEndpoints: [
        { route: '/api/users', methods: ['GET', 'POST'], statuses: [200] },
        { route: '/api/posts', methods: ['GET'], statuses: [200] },
      ],
    });

    const ctx = buildDiffContextFromFiles('origin/main', files, hints);

    expect(ctx.affectedApiEndpoints).toContain('/api/users');
    expect(ctx.affectedApiEndpoints).not.toContain('/api/posts');
  });

  it('matches changed files to route families', () => {
    const files: DiffFileEntry[] = [{ path: 'app/users/[id]/page.tsx', status: 'modified' }];
    const hints = makeRepoHints({
      routeFamilies: ['/users', '/settings'],
    });

    const ctx = buildDiffContextFromFiles('origin/main', files, hints);

    expect(ctx.affectedRouteFamilies).toContain('/users');
    expect(ctx.affectedRouteFamilies).not.toContain('/settings');
  });
});

describe('isNodeAffectedByDiff', () => {
  const diffContext = {
    baseRef: 'origin/main',
    changedFiles: [],
    affectedRoutes: ['/dashboard', '/users/:id'],
    affectedApiEndpoints: ['/api/users'],
    affectedRouteFamilies: ['/settings'],
  };

  it('returns false for undefined URL', () => {
    expect(isNodeAffectedByDiff(undefined, diffContext)).toBe(false);
  });

  it('matches exact route', () => {
    expect(isNodeAffectedByDiff('https://app.com/dashboard', diffContext)).toBe(true);
  });

  it('matches parameterised route', () => {
    expect(isNodeAffectedByDiff('https://app.com/users/42', diffContext)).toBe(true);
  });

  it('matches API endpoint', () => {
    expect(isNodeAffectedByDiff('https://app.com/api/users', diffContext)).toBe(true);
  });

  it('matches route family prefix', () => {
    expect(isNodeAffectedByDiff('https://app.com/settings/profile', diffContext)).toBe(true);
  });

  it('returns false for unaffected routes', () => {
    expect(isNodeAffectedByDiff('https://app.com/about', diffContext)).toBe(false);
  });

  it('handles bare paths without origin', () => {
    expect(isNodeAffectedByDiff('/dashboard', diffContext)).toBe(true);
    expect(isNodeAffectedByDiff('/about', diffContext)).toBe(false);
  });
});
