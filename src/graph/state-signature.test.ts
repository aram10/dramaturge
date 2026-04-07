import { describe, expect, it } from 'vitest';
import { buildStateSignatureFromUrl, buildStateSignatureKey } from './state-signature.js';

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
});
