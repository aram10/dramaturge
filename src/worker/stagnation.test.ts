// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, it, expect } from 'vitest';
import { StagnationTracker } from './stagnation.js';

describe('StagnationTracker', () => {
  it('starts not stagnant', () => {
    const tracker = new StagnationTracker(3);
    expect(tracker.isStagnant()).toBe(false);
  });

  it('becomes stagnant after N idle steps', () => {
    const tracker = new StagnationTracker(3);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.isStagnant()).toBe(false);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.isStagnant()).toBe(true);
  });

  it('resets on productive step (finding)', () => {
    const tracker = new StagnationTracker(2);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 1, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.isStagnant()).toBe(false);
  });

  it('resets on productive step (new control)', () => {
    const tracker = new StagnationTracker(2);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 1, edges: 0 });
    expect(tracker.isStagnant()).toBe(false);
  });

  it('resets on productive step (edge)', () => {
    const tracker = new StagnationTracker(2);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 1 });
    expect(tracker.isStagnant()).toBe(false);
  });

  it('returns consecutive idle count', () => {
    const tracker = new StagnationTracker(5);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.idleSteps).toBe(2);
  });
});
