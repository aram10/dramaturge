import { describe, it, expect } from 'vitest';
import { setInputRecordingPolicy, getInputRecordingPolicy } from './input-recording-policy.js';

describe('input-recording-policy', () => {
  it('round-trips set then get for a selector', () => {
    const target = {};
    setInputRecordingPolicy(target, '#password', 'secret');
    expect(getInputRecordingPolicy(target, '#password')).toBe('secret');
  });

  it('returns undefined for an unknown selector', () => {
    const target = {};
    setInputRecordingPolicy(target, '#password', 'secret');
    expect(getInputRecordingPolicy(target, '#username')).toBeUndefined();
  });

  it('returns undefined when target is undefined', () => {
    expect(getInputRecordingPolicy(undefined, '#password')).toBeUndefined();
  });

  it('ignores empty selector on set', () => {
    const target = {};
    setInputRecordingPolicy(target, '', 'safe');
    expect(getInputRecordingPolicy(target, '')).toBeUndefined();
  });

  it('ignores whitespace-only selector on set', () => {
    const target = {};
    setInputRecordingPolicy(target, '   ', 'safe');
    expect(getInputRecordingPolicy(target, '   ')).toBeUndefined();
  });

  it('stores multiple selectors on the same target', () => {
    const target = {};
    setInputRecordingPolicy(target, '#password', 'secret');
    setInputRecordingPolicy(target, '#email', 'safe');

    expect(getInputRecordingPolicy(target, '#password')).toBe('secret');
    expect(getInputRecordingPolicy(target, '#email')).toBe('safe');
  });

  it('policy store is not enumerable on the host object', () => {
    const target = {};
    setInputRecordingPolicy(target, '#input', 'safe');

    const keys = Object.keys(target);
    expect(keys).toHaveLength(0);

    const entries = Object.entries(target);
    expect(entries).toHaveLength(0);
  });

  it('trims selector whitespace before storing and retrieving', () => {
    const target = {};
    setInputRecordingPolicy(target, '  #password  ', 'secret');
    expect(getInputRecordingPolicy(target, '#password')).toBe('secret');
    expect(getInputRecordingPolicy(target, '  #password  ')).toBe('secret');
  });
});
