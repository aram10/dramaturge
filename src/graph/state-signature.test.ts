// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import {
  buildStateSignature,
  buildStateSignatureFromUrl,
  buildStateSignatureKey,
  hasPathOnlyStateSignature,
  normalizeUiMarkers,
  signaturesEqual,
} from './state-signature.js';

describe('buildStateSignatureFromUrl', () => {
  it('preserves meaningful query state for kb selection', () => {
    const first = buildStateSignatureFromUrl('https://example.com/?kb=one');
    const second = buildStateSignatureFromUrl('https://example.com/?kb=two');

    expect(first.query).toEqual([['kb', 'one']]);
    expect(second.query).toEqual([['kb', 'two']]);
    expect(buildStateSignatureKey(first)).not.toBe(buildStateSignatureKey(second));
  });

  it('preserves meaningful query state for filtered list pages', () => {
    const allItems = buildStateSignatureFromUrl(
      'https://example.com/manage/knowledge-bases?status=all'
    );
    const pendingItems = buildStateSignatureFromUrl(
      'https://example.com/manage/knowledge-bases?status=pending'
    );

    expect(buildStateSignatureKey(allItems)).not.toBe(buildStateSignatureKey(pendingItems));
  });

  it('ignores tracking-only query params when deduplicating states', () => {
    const plain = buildStateSignatureFromUrl('https://example.com/manage/knowledge-bases');
    const tracked = buildStateSignatureFromUrl(
      'https://example.com/manage/knowledge-bases?utm_source=mail&gclid=123'
    );

    expect(buildStateSignatureKey(plain)).toBe(buildStateSignatureKey(tracked));
  });

  it('normalizes trailing slashes', () => {
    const withSlash = buildStateSignatureFromUrl('https://example.com/page/');
    const withoutSlash = buildStateSignatureFromUrl('https://example.com/page');

    expect(withSlash.pathname).toBe('/page');
    expect(buildStateSignatureKey(withSlash)).toBe(buildStateSignatureKey(withoutSlash));
  });

  it('falls back to pathname parsing for invalid URLs', () => {
    const sig = buildStateSignatureFromUrl('http://[invalid');
    expect(sig.pathname).toBe('http://[invalid');
    expect(sig.query).toEqual([]);
  });

  it('sorts query parameters alphabetically', () => {
    const sig = buildStateSignatureFromUrl('https://example.com/?z=last&a=first');
    expect(sig.query).toEqual([
      ['a', 'first'],
      ['z', 'last'],
    ]);
  });

  it('uses baseUrl to resolve relative URLs', () => {
    const sig = buildStateSignatureFromUrl('/api/items', 'https://example.com');
    expect(sig.pathname).toBe('/api/items');
  });

  it('filters multiple tracking params (fbclid, msclkid, mc_cid, mc_eid)', () => {
    const plain = buildStateSignatureFromUrl('https://example.com/page');
    const tracked = buildStateSignatureFromUrl(
      'https://example.com/page?fbclid=abc&msclkid=def&mc_cid=ghi&mc_eid=jkl'
    );
    expect(buildStateSignatureKey(plain)).toBe(buildStateSignatureKey(tracked));
  });

  it('returns root pathname for empty path', () => {
    const sig = buildStateSignatureFromUrl('https://example.com');
    expect(sig.pathname).toBe('/');
  });
});

describe('normalizeUiMarkers', () => {
  it('deduplicates and sorts markers', () => {
    const result = normalizeUiMarkers(['Dashboard', 'dashboard', 'Settings']);
    expect(result).toEqual(['dashboard', 'settings']);
  });

  it('trims and normalizes whitespace', () => {
    const result = normalizeUiMarkers(['  hello   world  ', 'test']);
    expect(result).toEqual(['hello world', 'test']);
  });

  it('filters empty strings', () => {
    const result = normalizeUiMarkers(['', '  ', 'valid']);
    expect(result).toEqual(['valid']);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeUiMarkers([])).toEqual([]);
  });
});

describe('buildStateSignature', () => {
  it('combines URL signature with normalized UI markers', () => {
    const sig = buildStateSignature('https://example.com/page?tab=1', ['Active Tab', 'Nav Link']);
    expect(sig.pathname).toBe('/page');
    expect(sig.query).toEqual([['tab', '1']]);
    expect(sig.uiMarkers).toEqual(['active tab', 'nav link']);
  });

  it('produces different keys for different UI markers on the same URL', () => {
    const sig1 = buildStateSignature('https://example.com/page', ['Tab A']);
    const sig2 = buildStateSignature('https://example.com/page', ['Tab B']);
    expect(buildStateSignatureKey(sig1)).not.toBe(buildStateSignatureKey(sig2));
  });

  it('uses baseUrl when provided', () => {
    const sig = buildStateSignature('/relative', ['marker'], 'https://example.com');
    expect(sig.pathname).toBe('/relative');
  });
});

describe('signaturesEqual', () => {
  it('returns true for identical signatures', () => {
    const sig1 = buildStateSignature('https://example.com/page', ['Tab']);
    const sig2 = buildStateSignature('https://example.com/page', ['Tab']);
    expect(signaturesEqual(sig1, sig2)).toBe(true);
  });

  it('returns false for different pathnames', () => {
    const sig1 = buildStateSignature('https://example.com/page-a', []);
    const sig2 = buildStateSignature('https://example.com/page-b', []);
    expect(signaturesEqual(sig1, sig2)).toBe(false);
  });

  it('returns false for different UI markers', () => {
    const sig1 = buildStateSignature('https://example.com/page', ['Tab A']);
    const sig2 = buildStateSignature('https://example.com/page', ['Tab B']);
    expect(signaturesEqual(sig1, sig2)).toBe(false);
  });

  it('returns false for different query params', () => {
    const sig1 = buildStateSignature('https://example.com/page?a=1', []);
    const sig2 = buildStateSignature('https://example.com/page?a=2', []);
    expect(signaturesEqual(sig1, sig2)).toBe(false);
  });
});

describe('hasPathOnlyStateSignature', () => {
  it('returns true for signature with no query and no markers', () => {
    const sig = buildStateSignature('https://example.com/page', []);
    expect(hasPathOnlyStateSignature(sig)).toBe(true);
  });

  it('returns false when query params exist', () => {
    const sig = buildStateSignature('https://example.com/page?tab=1', []);
    expect(hasPathOnlyStateSignature(sig)).toBe(false);
  });

  it('returns false when UI markers exist', () => {
    const sig = buildStateSignature('https://example.com/page', ['Active Tab']);
    expect(hasPathOnlyStateSignature(sig)).toBe(false);
  });
});
