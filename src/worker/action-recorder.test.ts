import { describe, expect, it } from 'vitest';
import { REDACTED_VALUE } from '../redaction.js';
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
    setInputRecordingPolicy(page as any, "input[name='email']", 'safe');
    const recorder = new ActionRecorder(page as any);
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
    const recorder = new ActionRecorder(page as any);
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

  it('records selectOption values as input actions', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page as any);
    recorder.start();

    await page.locator("select[name='country']").selectOption('US');

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'input',
        selector: "select[name='country']",
        value: REDACTED_VALUE,
        status: 'worked',
      }),
    ]);
  });

  it('redacts recorded input values by default', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page as any);
    recorder.start();

    await page.locator("input[name='password']").fill('super-secret');
    await page.locator("input[name='otp']").type('123456');

    expect(recorder.getActions()).toEqual([
      expect.objectContaining({
        kind: 'input',
        selector: "input[name='password']",
        value: REDACTED_VALUE,
      }),
      expect.objectContaining({
        kind: 'input',
        selector: "input[name='otp']",
        value: REDACTED_VALUE,
      }),
    ]);
  });

  it('stops recording for already wrapped locators after stop is called', async () => {
    const page = createMockPage();
    const recorder = new ActionRecorder(page as any);
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
});
