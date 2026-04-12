import { describe, it, expect } from 'vitest';
import { stripJsonComments, parseJsoncObject } from './jsonc.js';

describe('stripJsonComments', () => {
  it('removes single-line comments', () => {
    const input = '{\n  "a": 1 // comment\n}';
    expect(stripJsonComments(input)).toBe('{\n  "a": 1 \n}');
  });

  it('removes multi-line comments', () => {
    const input = '{\n  /* comment */\n  "a": 1\n}';
    expect(stripJsonComments(input)).toBe('{\n  \n  "a": 1\n}');
  });

  it('preserves strings containing //', () => {
    const input = '{ "url": "https://example.com" }';
    expect(stripJsonComments(input)).toBe('{ "url": "https://example.com" }');
  });

  it('handles empty input', () => {
    expect(stripJsonComments('')).toBe('');
  });
});

describe('parseJsoncObject', () => {
  it('parses standard JSON', () => {
    const result = parseJsoncObject('{ "name": "test", "count": 42 }');
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('parses JSONC with comments', () => {
    const input = [
      '{',
      '  // This is a comment',
      '  "key": "value",',
      '  /* block comment */',
      '  "num": 1',
      '}',
    ].join('\n');

    expect(parseJsoncObject(input)).toEqual({ key: 'value', num: 1 });
  });

  it('throws on trailing commas (not supported by JSON.parse)', () => {
    expect(() => parseJsoncObject('{ "a": 1, }')).toThrow();
  });

  it('throws on invalid input', () => {
    expect(() => parseJsoncObject('not json')).toThrow();
  });
});
