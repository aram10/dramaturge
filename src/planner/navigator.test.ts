import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Navigator } from './navigator.js';
import { captureFingerprint } from '../graph/fingerprint.js';
import { waitForPageStable } from '../worker/page-stability.js';
import type { PageFingerprint } from '../types.js';

vi.mock('../graph/fingerprint.js', () => ({
  captureFingerprint: vi.fn(),
}));

vi.mock('../worker/page-stability.js', () => ({
  waitForPageStable: vi.fn(),
}));

function makeFingerprint(normalizedPath: string, hash: string): PageFingerprint {
  return {
    normalizedPath,
    signature: {
      pathname: normalizedPath,
      query: [],
      uiMarkers: [],
    },
    title: '',
    heading: '',
    dialogTitles: [],
    hash,
  };
}

describe('Navigator.navigateFromNode', () => {
  beforeEach(() => {
    vi.mocked(captureFingerprint).mockReset();
    vi.mocked(waitForPageStable).mockReset();
    vi.mocked(waitForPageStable).mockResolvedValue('stable');
  });

  it('restores the source node before following a discovered selector edge', async () => {
    const wizardFingerprint = makeFingerprint('/wizard', 'wizard-node');
    vi.mocked(captureFingerprint).mockResolvedValueOnce(wizardFingerprint);

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://example.com/'),
    } as any;
    const stagehand = {
      act: vi.fn().mockResolvedValue(undefined),
    } as any;
    const graph = {
      getNode: vi.fn().mockReturnValue({
        id: 'wizard-node',
        url: 'https://example.com/wizard?step=2',
        fingerprint: wizardFingerprint,
        depth: 1,
      }),
      pathToNode: vi.fn().mockReturnValue([]),
    } as any;

    const navigator = new Navigator();
    const result = await navigator.navigateFromNode(
      'wizard-node',
      { selector: '#wizard-next' },
      graph,
      page,
      stagehand,
      'https://example.com/'
    );

    expect(result).toEqual({ success: true });
    expect(page.goto).toHaveBeenCalledWith('https://example.com/wizard?step=2');
    expect(stagehand.act).toHaveBeenCalledWith('Click the element matching "#wizard-next"');
    expect(page.goto.mock.invocationCallOrder[0]).toBeLessThan(
      stagehand.act.mock.invocationCallOrder[0]
    );
  });

  it('fails restoration when fingerprint verification throws', async () => {
    vi.mocked(captureFingerprint).mockRejectedValueOnce(
      new Error('Execution context was destroyed')
    );

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://example.com/'),
    } as any;
    const stagehand = {
      act: vi.fn().mockResolvedValue(undefined),
    } as any;
    const graph = {
      getNode: vi.fn().mockReturnValue({
        id: 'wizard-node',
        url: 'https://example.com/wizard?step=2',
        fingerprint: makeFingerprint('/wizard', 'wizard-node'),
        depth: 1,
      }),
      pathToNode: vi.fn().mockReturnValue([]),
    } as any;

    const navigator = new Navigator();
    const result = await navigator.navigateFromNode(
      'wizard-node',
      { selector: '#wizard-next' },
      graph,
      page,
      stagehand,
      'https://example.com/'
    );

    expect(result).toEqual({
      success: false,
      reason: 'Navigation verification failed: Execution context was destroyed',
    });
    expect(stagehand.act).not.toHaveBeenCalled();
  });
});
