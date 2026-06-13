// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { captureFingerprint, isDuplicateState, markVisited } from './fingerprint.js';
import type { PageFingerprint } from '../types.js';

interface MockPageInput {
  url: string;
  title?: string;
  heading?: string;
  dialogTitles?: string[];
  uiMarkers?: string[];
}

/**
 * captureFingerprint passes a callback to page.evaluate that runs in the browser.
 * The mock ignores the callback and returns the structured data the callback would
 * have produced, mirroring the real DOM extraction contract.
 */
function createMockPage(input: MockPageInput) {
  return {
    url: () => input.url,
    evaluate: async () => ({
      title: input.title ?? '',
      heading: input.heading ?? '',
      dialogTitles: input.dialogTitles ?? [],
      uiMarkers: input.uiMarkers ?? [],
    }),
  };
}

describe('captureFingerprint', () => {
  it('captures normalized path, title, heading, and dialog titles', async () => {
    const page = createMockPage({
      url: 'https://example.com/dashboard/',
      title: 'Dashboard',
      heading: 'Welcome back',
      dialogTitles: ['Confirm'],
    });

    const fingerprint = await captureFingerprint(page as any);

    expect(fingerprint.normalizedPath).toBe('/dashboard');
    expect(fingerprint.title).toBe('Dashboard');
    expect(fingerprint.heading).toBe('Welcome back');
    expect(fingerprint.dialogTitles).toEqual(['Confirm']);
    expect(fingerprint.hash).toMatch(/^[a-f0-9]{12}$/);
  });

  it('produces identical hashes for the same page state', async () => {
    const input: MockPageInput = {
      url: 'https://example.com/users?page=2',
      title: 'Users',
      heading: 'User list',
    };

    const first = await captureFingerprint(createMockPage(input) as any);
    const second = await captureFingerprint(createMockPage(input) as any);

    expect(first.hash).toBe(second.hash);
  });

  it('produces different hashes when an open dialog changes the state', async () => {
    const base = {
      url: 'https://example.com/settings',
      title: 'Settings',
      heading: 'Settings',
    };
    const withoutDialog = await captureFingerprint(createMockPage(base) as any);
    const withDialog = await captureFingerprint(
      createMockPage({ ...base, dialogTitles: ['Delete account'] }) as any
    );

    expect(withoutDialog.hash).not.toBe(withDialog.hash);
  });

  it('ignores tracking query params when fingerprinting', async () => {
    const clean = await captureFingerprint(
      createMockPage({ url: 'https://example.com/catalog', title: 'Catalog' }) as any
    );
    const tracked = await captureFingerprint(
      createMockPage({
        url: 'https://example.com/catalog?utm_source=news',
        title: 'Catalog',
      }) as any
    );

    expect(clean.hash).toBe(tracked.hash);
  });

  it('distinguishes states that differ only by active UI markers', async () => {
    const base = { url: 'https://example.com/reports', title: 'Reports', heading: 'Reports' };
    const tabA = await captureFingerprint(
      createMockPage({ ...base, uiMarkers: ['tab-daily'] }) as any
    );
    const tabB = await captureFingerprint(
      createMockPage({ ...base, uiMarkers: ['tab-weekly'] }) as any
    );

    expect(tabA.hash).not.toBe(tabB.hash);
    expect(tabA.signature.uiMarkers).toEqual(['tab-daily']);
  });

  it('treats UI marker ordering and casing as equivalent', async () => {
    const base = { url: 'https://example.com/reports', title: 'Reports' };
    const ordered = await captureFingerprint(
      createMockPage({ ...base, uiMarkers: ['Tab-Daily', 'Sort-Asc'] }) as any
    );
    const reordered = await captureFingerprint(
      createMockPage({ ...base, uiMarkers: ['sort-asc', 'tab-daily'] }) as any
    );

    expect(ordered.hash).toBe(reordered.hash);
  });

  it('normalizes a root path to "/"', async () => {
    const fingerprint = await captureFingerprint(
      createMockPage({ url: 'https://example.com/' }) as any
    );

    expect(fingerprint.normalizedPath).toBe('/');
    expect(fingerprint.title).toBe('');
    expect(fingerprint.heading).toBe('');
    expect(fingerprint.dialogTitles).toEqual([]);
  });
});

function makeFingerprint(overrides: Partial<PageFingerprint> = {}): PageFingerprint {
  return {
    normalizedPath: '/page',
    signature: { pathname: '/page', query: [], uiMarkers: [] },
    title: 'Page',
    heading: 'Page',
    dialogTitles: [],
    hash: 'abc123def456',
    ...overrides,
  };
}

describe('isDuplicateState', () => {
  it('returns false when the fingerprint hash has not been visited', () => {
    const visited = new Set<string>();
    expect(isDuplicateState(makeFingerprint(), visited)).toBe(false);
  });

  it('returns true when the fingerprint hash is already in the visited set', () => {
    const visited = new Set<string>(['abc123def456']);
    expect(isDuplicateState(makeFingerprint({ hash: 'abc123def456' }), visited)).toBe(true);
  });

  it('does not match a different hash', () => {
    const visited = new Set<string>(['other-hash']);
    expect(isDuplicateState(makeFingerprint({ hash: 'abc123def456' }), visited)).toBe(false);
  });
});

describe('markVisited', () => {
  it('adds the fingerprint hash to the visited set', () => {
    const visited = new Set<string>();
    markVisited(makeFingerprint({ hash: 'hash-1' }), visited);
    expect(visited.has('hash-1')).toBe(true);
  });

  it('makes a subsequent isDuplicateState check return true', () => {
    const visited = new Set<string>();
    const fingerprint = makeFingerprint({ hash: 'hash-2' });

    expect(isDuplicateState(fingerprint, visited)).toBe(false);
    markVisited(fingerprint, visited);
    expect(isDuplicateState(fingerprint, visited)).toBe(true);
  });

  it('is idempotent for repeated marking of the same hash', () => {
    const visited = new Set<string>();
    const fingerprint = makeFingerprint({ hash: 'hash-3' });

    markVisited(fingerprint, visited);
    markVisited(fingerprint, visited);

    expect(visited.size).toBe(1);
  });
});
