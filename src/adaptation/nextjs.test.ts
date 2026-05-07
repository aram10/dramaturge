// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanNextJsRepo } from './nextjs.js';

let tempRoot: string | undefined;

function makeTempRepo(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'dramaturge-nextjs-'));
  return tempRoot;
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf-8');
}

describe('scanNextJsRepo', () => {
  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('discovers app pages, route handlers, and selector sources without path regexes', () => {
    const root = makeTempRepo();

    writeFile(
      join(root, 'app', 'page.tsx'),
      ['export default function Page() {', '  return <main id="home">Home</main>;', '}'].join('\n')
    );
    writeFile(
      join(root, 'app', 'blog', 'page.mdx'),
      ['# Blog', '<button data-testid="blog-filter">Filter</button>'].join('\n')
    );
    writeFile(
      join(root, 'app', 'api', 'things', 'route.ts'),
      [
        'const CreateThingSchema = {};',
        'export async function GET() {',
        '  requireAuth();',
        '  return Response.json({}, { status: 401 });',
        '}',
        'export const POST = async () => Response.json({}, { status: 201 });',
      ].join('\n')
    );
    writeFile(
      join(root, 'components', 'Nav.tsx'),
      [
        'export function Nav() {',
        '  return <a data-testid="nav-blog" href="/blog?tab=recent">Blog</a>;',
        '}',
      ].join('\n')
    );
    writeFile(
      join(root, 'tests', 'nav.test.tsx'),
      '<button data-testid="test-selector-source">Covered source</button>;'
    );

    const hints = scanNextJsRepo(root);

    expect(hints.routes).toEqual(expect.arrayContaining(['/', '/blog', '/blog?tab=recent']));
    expect(hints.stableSelectors).toEqual(
      expect.arrayContaining([
        '#home',
        '[data-testid="blog-filter"]',
        '[data-testid="nav-blog"]',
        '[data-testid="test-selector-source"]',
      ])
    );
    expect(hints.apiEndpoints).toContainEqual({
      route: '/api/things',
      methods: ['GET', 'POST'],
      statuses: [201, 401],
      authRequired: true,
      validationSchemas: ['CreateThingSchema'],
    });
    expect(hints.expectedHttpNoise).toContainEqual({
      pathPrefix: '/api/things',
      statuses: [401],
    });
  });
});
