// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { ActionRecorder } from './action-recorder.js';
import { setInputRecordingPolicy } from './input-recording-policy.js';

function createMockPage() {
  function createLocator(selector: string) {
    return {
      async click() {
        return undefined;
      },
      async fill(_value: string) {
        return undefined;
      },
      async type(_value: string) {
        return undefined;
      },
      async press(_key: string) {
        return undefined;
      },
      async selectOption(_value: string | { label: string }) {
        return undefined;
      },
      locator(childSelector: string) {
        return createLocator(`${selector} >> ${childSelector}`);
      },
      getByRole(role: string, options?: { name?: string }) {
        const nameSuffix = options?.name ? `[name=${options.name}]` : '';
        return createLocator(`${selector} >> role=${role}${nameSuffix}`);
      },
    };
  }

  const page = {
    keyboard: {
      async press(_key: string) {
        return undefined;
      },
    },
    async goto(_url: string) {
      return undefined;
    },
    locator(selector: string) {
      return createLocator(selector);
    },
    getByRole(role: string, options?: { name?: string }) {
      return createLocator(options?.name ? `role=${role}[name=${options.name}]` : `role=${role}`);
    },
  };

  return page;
}

describe('ActionRecorder', () => {
  it('records page navigation and common locator interactions', async () => {
    const page = createMockPage();
    setInputRecordingPolicy(page, "input[name='email']", 'safe');
    const recorder = new ActionRecorder(page);
    recorder.start();

    await page.goto('https://example.com/login');
    await page.locator("input[name='email']").fill('user@example.com');
    await page.locator("button[type='submit']").click();
    await page.keyboard.press('Enter');

    const actions = recorder.getActions();
    expect(actions).toHaveLength(4);
    expect(actions.map((action) => action.kind)).toEqual(['navigate', 'input', 'click', 'keydown']);
    expect(actions[0]).toMatchObject({
      kind: 'navigate',
      url: 'https://example.com/login',
      source: 'page',
      status: 'worked',
    });
    expect(actions[1]).toMatchObject({
      kind: 'input',
      selector: "input[name='email']",
      value: 'user@example.com',
    });
    expect(actions[2]).toMatchObject({
      kind: 'click',
      selector: "button[type='submit']",
    });
    expect(actions[3]).toMatchObject({
      kind: 'keydown',
      key: 'Enter',
    });
  });

  it('records chained locator queries with selector context', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page);
    recorder.start();

    await page.locator("[data-testid='dialog']").getByRole('button', { name: 'Save' }).click();

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'click',
        selector: "[data-testid='dialog'] >> role=button[name=Save]",
        status: 'worked',
      }),
    ]);
  });

  it('records selectOption values as redacted input actions by default', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page);
    recorder.start();

    await page.locator("select[name='country']").selectOption('US');

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'input',
        selector: "select[name='country']",
        value: undefined,
        redacted: true,
        status: 'worked',
      }),
    ]);
  });

  it('redacts recorded input values by default', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page);
    recorder.start();

    await page.locator("input[name='email']").fill('user@example.com');

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'input',
        selector: "input[name='email']",
        value: undefined,
        redacted: true,
        status: 'worked',
      }),
    ]);
    expect(JSON.stringify(recorder.getActions())).not.toContain('user@example.com');
    expect(JSON.stringify(recorder.getActions())).not.toContain('[REDACTED]');
  });

  it('matches safe input policies even when configured selectors include surrounding whitespace', async () => {
    const page = createMockPage();
    setInputRecordingPolicy(page, "  input[name='email']  ", 'safe');
    const recorder = new ActionRecorder(page);
    recorder.start();

    await page.locator("input[name='email']").fill('user@example.com');

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'input',
        selector: "input[name='email']",
        value: 'user@example.com',
      }),
    ]);
  });

  it('redacts input values for sensitive selectors before persisting them', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page);
    recorder.start();

    await page.getByRole('textbox', { name: 'Password' }).fill('super-secret-password');

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'input',
        selector: 'role=textbox[name=Password]',
        value: undefined,
        redacted: true,
        status: 'worked',
      }),
    ]);
    expect(JSON.stringify(recorder.getActions())).not.toContain('super-secret-password');
    expect(JSON.stringify(recorder.getActions())).not.toContain('[REDACTED]');
  });

  it('stops recording for already wrapped locators after stop is called', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page);
    recorder.start();

    const saveButton = page.getByRole('button', { name: 'Save' });
    recorder.stop();

    await saveButton.click();

    expect(recorder.getActions()).toEqual([]);
  });

  it('records worker-tool actions and exposes recent ids and summaries', () => {
    const recorder = new ActionRecorder();

    const first = recorder.recordToolAction({
      kind: 'screenshot',
      summary: 'capture screenshot create-button',
      status: 'recorded',
    });
    const second = recorder.recordToolAction({
      kind: 'submit',
      selector: 'save-button',
      summary: 'submit save-button -> worked',
      status: 'worked',
    });

    expect(first.id).toMatch(/^act-/);
    expect(second.id).toMatch(/^act-/);
    expect(recorder.getRecentActionIds()).toEqual([first.id, second.id]);
    expect(recorder.getRecentSummaries()).toEqual([
      'capture screenshot create-button',
      'submit save-button -> worked',
    ]);
  });

  it('redacts worker-tool input actions for sensitive labels at the recording boundary', () => {
    const recorder = new ActionRecorder();
    const placeholder = 'example-secret';

    const action = recorder.recordToolAction({
      kind: 'input',
      selector: 'label=API token',
      value: placeholder,
      summary: 'input label=API token -> worked',
      status: 'worked',
    });

    expect(action).toMatchObject({
      kind: 'input',
      selector: 'label=API token',
      redacted: true,
    });
    expect(action.value).toBeUndefined();
    expect(recorder.getActions()).toEqual([
      expect.objectContaining({ value: undefined, redacted: true }),
    ]);
    expect(JSON.stringify(recorder.getActions())).not.toContain(placeholder);
    expect(JSON.stringify(recorder.getActions())).not.toContain('[REDACTED]');
  });
});
