import { describe, it, expect } from 'vitest';
import {
  UNTRUSTED_PROMPT_INSTRUCTION,
  sanitizeUntrustedPromptContent,
  wrapUntrustedPromptContent,
} from './prompt-safety.js';

describe('UNTRUSTED_PROMPT_INSTRUCTION', () => {
  it('is a non-empty string', () => {
    expect(typeof UNTRUSTED_PROMPT_INSTRUCTION).toBe('string');
    expect(UNTRUSTED_PROMPT_INSTRUCTION.length).toBeGreaterThan(0);
  });
});

describe('sanitizeUntrustedPromptContent', () => {
  it('returns text without backticks unchanged', () => {
    expect(sanitizeUntrustedPromptContent('hello world')).toBe('hello world');
  });

  it('replaces triple backticks', () => {
    expect(sanitizeUntrustedPromptContent('before ``` after')).toBe('before ``\\` after');
  });

  it('handles multiple occurrences of triple backticks', () => {
    expect(sanitizeUntrustedPromptContent('```a```b```')).toBe('``\\`a``\\`b``\\`');
  });

  it('handles empty string', () => {
    expect(sanitizeUntrustedPromptContent('')).toBe('');
  });
});

describe('wrapUntrustedPromptContent', () => {
  it('wraps content with BEGIN/END markers', () => {
    const result = wrapUntrustedPromptContent('LABEL', 'content');
    expect(result).toContain('BEGIN UNTRUSTED LABEL');
    expect(result).toContain('END UNTRUSTED LABEL');
  });

  it('includes the label in both markers', () => {
    const result = wrapUntrustedPromptContent('PAGE_HTML', 'data');
    expect(result).toMatch(/^BEGIN UNTRUSTED PAGE_HTML\n/);
    expect(result).toMatch(/\nEND UNTRUSTED PAGE_HTML$/);
  });

  it('sanitizes content inside the markers', () => {
    const result = wrapUntrustedPromptContent('INPUT', 'has ``` backticks');
    expect(result).not.toContain('```\nhas ```');
    expect(result).toContain('has ``\\` backticks');
  });

  it('wraps sanitized content in fenced code blocks', () => {
    const result = wrapUntrustedPromptContent('DATA', 'hello');
    const lines = result.split('\n');
    expect(lines[0]).toBe('BEGIN UNTRUSTED DATA');
    expect(lines[1]).toBe('```');
    expect(lines[2]).toBe('hello');
    expect(lines[3]).toBe('```');
    expect(lines[4]).toBe('END UNTRUSTED DATA');
  });
});
