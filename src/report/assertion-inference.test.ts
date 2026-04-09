// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { inferAssertions } from './assertion-inference.js';

describe('inferAssertions', () => {
  it('infers an alert assertion from success-message expectations', () => {
    const assertions = inferAssertions({
      title: 'Save feedback is unclear',
      expected: 'A success message confirms the save',
      actual: 'The page changes without feedback',
    });

    expect(assertions.map((assertion) => assertion.code)).toContain(
      'await expect(page.getByRole("alert")).toBeVisible();'
    );
  });

  it('infers a dialog assertion when the expected behavior mentions a modal opening', () => {
    const assertions = inferAssertions({
      title: 'Create dialog never opens',
      expected: 'The create dialog opens',
      actual: 'Nothing happens',
    });

    expect(assertions.map((assertion) => assertion.code)).toContain(
      'await expect(page.getByRole("dialog")).toBeVisible();'
    );
  });

  it('infers an HTTP response assertion when text mentions a 500 error', () => {
    const assertions = inferAssertions({
      title: 'Dashboard returns 500 on load',
      expected: 'Page loads normally',
      actual: 'A 500 Internal Server Error is returned',
    });

    const codes = assertions.map((a) => a.code);
    expect(codes).toContain('expect(serverErrors, "No server errors expected").toHaveLength(0);');
    const preamble = assertions.find((a) => a.preamble);
    expect(preamble?.preamble).toContain('page.on("response"');
    expect(preamble?.preamble).toContain('resp.status() >= 500');
  });

  it('infers an HTTP response assertion for any 5xx status code', () => {
    const assertions = inferAssertions({
      title: 'Storage quota exceeded',
      expected: 'Upload succeeds',
      actual: 'Server responds with 507 Insufficient Storage',
    });

    const codes = assertions.map((a) => a.code);
    expect(codes).toContain('expect(serverErrors, "No server errors expected").toHaveLength(0);');
  });

  it('infers an HTTP response assertion via network-error evidence with broader status check', () => {
    const assertions = inferAssertions({
      title: 'Data fetch fails silently',
      expected: 'Data loads',
      actual: 'Nothing shown',
      evidenceTypes: ['network-error'],
    });

    expect(assertions.map((a) => a.code)).toContain(
      'expect(serverErrors, "No server errors expected").toHaveLength(0);'
    );
    const preamble = assertions.find((a) => a.preamble?.includes('serverErrors'));
    expect(preamble?.preamble).toContain('resp.status() >= 400 || resp.status() === 0');
  });

  it('infers a form validation assertion when validation is missing', () => {
    const assertions = inferAssertions({
      title: 'Required field validation does not appear',
      expected: 'Validation error message is shown for required field',
      actual: 'Form submits without validation feedback',
    });

    const codes = assertions.map((a) => a.code);
    expect(codes).toContain(
      `await expect(page.locator('[aria-invalid="true"], [role="alert"], .error-message, .field-error')).toBeVisible();`
    );
  });

  it('infers a CRUD/list assertion when items are expected to appear', () => {
    const assertions = inferAssertions({
      title: 'New item not added to list',
      expected: 'The new item appears in the list',
      actual: 'The list remains empty after creation',
    });

    const codes = assertions.map((a) => a.code);
    expect(codes).toContain(
      `await expect(page.locator('table tbody tr, [role="row"], [role="listitem"]')).not.toHaveCount(0);`
    );
  });

  it('does not infer a CRUD/list assertion for deletion scenarios', () => {
    const assertions = inferAssertions({
      title: 'Deleted row still visible',
      expected: 'Row is removed from the table',
      actual: 'Deleted row remains in the table after deletion',
    });

    expect(assertions.map((a) => a.code)).not.toContain(
      `await expect(page.locator('table tbody tr, [role="row"], [role="listitem"]')).not.toHaveCount(0);`
    );
  });

  it('infers a visual diff assertion when layout issues are mentioned', () => {
    const assertions = inferAssertions({
      title: 'Sidebar layout breaks on resize',
      expected: 'Sidebar renders correctly',
      actual: 'Content overlapping and misaligned elements',
    });

    expect(assertions.map((a) => a.code)).toContain('await expect(page).toHaveScreenshot();');
  });

  it('infers a visual diff assertion via visual-diff evidence', () => {
    const assertions = inferAssertions({
      title: 'Page differs from baseline',
      expected: 'Matches previous run',
      actual: 'Pixel difference detected',
      evidenceTypes: ['visual-diff'],
    });

    expect(assertions.map((a) => a.code)).toContain('await expect(page).toHaveScreenshot();');
  });

  it('infers an API contract assertion when contract deviation is described', () => {
    const assertions = inferAssertions({
      title: 'API endpoint returns unexpected schema',
      expected: 'Response body matches contract',
      actual: 'Schema mismatch on /api/users endpoint',
    });

    const codes = assertions.map((a) => a.code);
    expect(codes).toContain('expect(apiErrors, "No API errors expected").toHaveLength(0);');
    const preamble = assertions.find((a) => a.preamble?.includes('apiErrors'));
    expect(preamble?.preamble).toContain('page.on("response"');
    expect(preamble?.preamble).toContain('resp.status() >= 400');
  });

  it('infers a TODO comment for api-contract evidence without text match', () => {
    const assertions = inferAssertions({
      title: 'Response shape changed',
      expected: 'Valid shape',
      actual: 'Missing fields',
      evidenceTypes: ['api-contract'],
    });

    const codes = assertions.map((a) => a.code);
    expect(codes.some((c) => c.includes('TODO: Validate API response body'))).toBe(true);
    expect(codes).not.toContain('expect(apiErrors, "No API errors expected").toHaveLength(0);');
  });

  it('infers a console error assertion when JS errors are reported', () => {
    const assertions = inferAssertions({
      title: 'Uncaught TypeError on form submit',
      expected: 'Form submits without errors',
      actual: 'Console error: Uncaught TypeError: Cannot read properties of null',
    });

    const codes = assertions.map((a) => a.code);
    expect(codes).toContain('expect(consoleErrors, "No console errors expected").toHaveLength(0);');
    const preamble = assertions.find((a) => a.preamble?.includes('consoleErrors'));
    expect(preamble?.preamble).toContain('page.on("console"');
  });

  it('infers a console error assertion via console-error evidence', () => {
    const assertions = inferAssertions({
      title: 'JS error during navigation',
      expected: 'Clean navigation',
      actual: 'Error thrown during transition',
      evidenceTypes: ['console-error'],
    });

    expect(assertions.map((a) => a.code)).toContain(
      'expect(consoleErrors, "No console errors expected").toHaveLength(0);'
    );
  });

  it('returns no assertions when text has no recognizable pattern', () => {
    const assertions = inferAssertions({
      title: 'Minor color inconsistency',
      expected: 'Color matches brand guide',
      actual: 'Slightly different shade',
    });

    expect(assertions).toHaveLength(0);
  });
});
