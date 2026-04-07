import { describe, expect, it } from 'vitest';
import { generatePlaywrightTests } from './test-gen.js';
import type { RunResult } from '../types.js';

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    targetUrl: 'https://example.com',
    startTime: new Date('2026-03-25T10:00:00Z'),
    endTime: new Date('2026-03-25T10:05:00Z'),
    areaResults: [],
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
    ...overrides,
  };
}

describe('generatePlaywrightTests', () => {
  it('builds a replayable Playwright spec from action traces', () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: 'Knowledge bases',
            url: 'https://example.com/manage/knowledge-bases',
            steps: 3,
            findings: [
              {
                ref: 'fid-create-dialog',
                category: 'Bug',
                severity: 'Major',
                title: 'Create dialog never opens',
                stepsToReproduce: ['Open knowledge bases', 'Click Create'],
                expected: 'The create dialog opens',
                actual: 'Nothing happens',
                meta: {
                  source: 'agent',
                  confidence: 'medium',
                  repro: {
                    objective: 'Validate create dialog flow',
                    route: 'https://example.com/manage/knowledge-bases',
                    breadcrumbs: [
                      'navigate https://example.com/manage/knowledge-bases -> worked',
                      "click button[data-testid='create'] -> worked",
                    ],
                    actionIds: ['act-nav', 'act-click'],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [
              {
                id: 'act-nav',
                kind: 'navigate',
                url: 'https://example.com/manage/knowledge-bases',
                summary: 'navigate https://example.com/manage/knowledge-bases -> worked',
                source: 'page',
                status: 'worked',
                timestamp: '2026-03-25T10:01:00Z',
              },
              {
                id: 'act-click',
                kind: 'click',
                selector: "button[data-testid='create']",
                summary: "click button[data-testid='create'] -> worked",
                source: 'page',
                status: 'worked',
                timestamp: '2026-03-25T10:01:01Z',
              },
            ],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
            pageType: 'list',
            status: 'explored',
          },
        ],
      })
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]?.filename).toBe('bug-001-create-dialog-never-opens.spec.ts');
    expect(generated[0]?.content).toContain('import { test, expect } from "@playwright/test";');
    expect(generated[0]?.content).toContain(
      'await page.goto("https://example.com/manage/knowledge-bases");'
    );
    expect(generated[0]?.content).toContain(
      'await page.locator("button[data-testid=\'create\']").click();'
    );
    expect(generated[0]?.content).toContain(
      'await expect(page.getByRole("dialog")).toBeVisible();'
    );
    expect(generated[0]?.content).toContain('Expected: The create dialog opens');
    expect(generated[0]?.content).toContain('Actual: Nothing happens');
    expect(generated[0]?.content).not.toContain('expect(true).toBe(true)');
  });

  it('falls back to breadcrumb comments when no replayable actions are available', () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: 'Settings',
            steps: 1,
            findings: [
              {
                ref: 'fid-settings',
                category: 'UX Concern',
                severity: 'Minor',
                title: 'Save feedback is unclear',
                stepsToReproduce: ['Open settings', 'Click Save'],
                expected: 'A success message confirms the save',
                actual: 'The page changes without feedback',
                meta: {
                  source: 'agent',
                  confidence: 'low',
                  repro: {
                    objective: 'Inspect save feedback',
                    route: 'https://example.com/settings',
                    breadcrumbs: ['Open settings', 'Click Save'],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
            pageType: 'settings',
            status: 'explored',
          },
        ],
      })
    );

    expect(generated[0]?.content).toContain('// Breadcrumbs:');
    expect(generated[0]?.content).toContain('// - Open settings');
    expect(generated[0]?.content).toContain('// - Click Save');
  });

  it('uses alert assertions for feedback-oriented findings', () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: 'Settings',
            steps: 1,
            findings: [
              {
                ref: 'fid-settings-feedback',
                category: 'UX Concern',
                severity: 'Minor',
                title: 'Save feedback is unclear',
                stepsToReproduce: ['Open settings', 'Click Save'],
                expected: 'A success message confirms the save',
                actual: 'The page changes without feedback',
                meta: {
                  source: 'agent',
                  confidence: 'medium',
                  repro: {
                    objective: 'Inspect save feedback',
                    route: 'https://example.com/settings',
                    breadcrumbs: ['Open settings', 'Click Save'],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
            pageType: 'settings',
            status: 'explored',
          },
        ],
      })
    );

    expect(generated[0]?.content).toContain('await expect(page.getByRole("alert")).toBeVisible();');
  });

  it('places preamble listeners before actions for console-error evidence', () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: 'Dashboard',
            url: 'https://example.com/dashboard',
            steps: 2,
            findings: [
              {
                ref: 'fid-console-err',
                category: 'Bug',
                severity: 'Major',
                title: 'Uncaught TypeError on page load',
                stepsToReproduce: ['Open dashboard'],
                expected: 'No console errors',
                actual: 'Uncaught TypeError thrown',
                evidenceIds: ['ev-console-1'],
                meta: {
                  source: 'auto-capture',
                  confidence: 'high',
                  repro: {
                    objective: 'Reproduce console error',
                    route: 'https://example.com/dashboard',
                    breadcrumbs: ['Open dashboard'],
                    evidenceIds: ['ev-console-1'],
                  },
                },
              },
            ],
            replayableActions: [
              {
                id: 'act-nav-dash',
                kind: 'navigate',
                url: 'https://example.com/dashboard',
                summary: 'navigate to dashboard',
                source: 'page',
                status: 'worked',
                timestamp: '2026-03-25T10:01:00Z',
              },
            ],
            screenshots: new Map(),
            evidence: [
              {
                id: 'ev-console-1',
                type: 'console-error',
                summary: 'Uncaught TypeError: Cannot read properties of null',
                timestamp: '2026-03-25T10:01:01Z',
                relatedFindingIds: ['fid-console-err'],
              },
            ],
            coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
            pageType: 'dashboard',
            status: 'explored',
          },
        ],
      })
    );

    expect(generated).toHaveLength(1);
    const content = generated[0]!.content;
    // Preamble (console listener) appears before actions
    // Preamble (console listener) appears before navigation
    const consoleListenerPos = content.indexOf('page.on("console"');
    const navActionPos = content.indexOf('await page.goto');
    const assertionPos = content.indexOf('expect(consoleErrors, "No console errors expected")');
    expect(consoleListenerPos).toBeGreaterThan(-1);
    expect(consoleListenerPos).toBeLessThan(navActionPos);
    expect(assertionPos).toBeGreaterThan(navActionPos);
    expect(content).toContain('const consoleErrors: string[] = [];');
    expect(content).toContain(
      'expect(consoleErrors, "No console errors expected").toHaveLength(0);'
    );
  });

  it('includes HTTP response listener preamble for server-error findings', () => {
    const generated = generatePlaywrightTests(
      makeResult({
        areaResults: [
          {
            name: 'API page',
            url: 'https://example.com/api-page',
            steps: 1,
            findings: [
              {
                ref: 'fid-500',
                category: 'Bug',
                severity: 'Critical',
                title: '500 Internal Server Error on submit',
                stepsToReproduce: ['Submit form'],
                expected: 'Form submits successfully',
                actual: 'Server returns 500 error',
                meta: {
                  source: 'agent',
                  confidence: 'high',
                  repro: {
                    objective: 'Reproduce server error',
                    route: 'https://example.com/api-page',
                    breadcrumbs: ['Submit form'],
                    evidenceIds: [],
                  },
                },
              },
            ],
            replayableActions: [],
            screenshots: new Map(),
            evidence: [],
            coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
            pageType: 'form',
            status: 'explored',
          },
        ],
      })
    );

    expect(generated).toHaveLength(1);
    const content = generated[0]!.content;
    expect(content).toContain('const serverErrors: string[] = [];');
    expect(content).toContain('page.on("response"');
    expect(content).toContain('expect(serverErrors, "No server errors expected").toHaveLength(0);');
  });
});
