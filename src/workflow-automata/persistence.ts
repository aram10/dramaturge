// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowAutomaton } from './types.js';

function sanitizeProfile(profile: string | undefined): string {
  return (profile ?? 'default').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
}

function persistenceDir(baseDir: string): string {
  return join(baseDir, 'workflow-automata');
}

function latestPath(baseDir: string, profile: string | undefined): string {
  return join(persistenceDir(baseDir), `latest-${sanitizeProfile(profile)}.json`);
}

function historyPath(baseDir: string, automaton: WorkflowAutomaton): string {
  const stamp = automaton.createdAt.replace(/[:.]/g, '-');
  return join(persistenceDir(baseDir), `${stamp}--${sanitizeProfile(automaton.authProfile)}.json`);
}

export function readWorkflowAutomaton(path: string): WorkflowAutomaton | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WorkflowAutomaton;
  } catch {
    return undefined;
  }
}

export function loadPreviousWorkflowAutomaton(
  baseDir: string,
  profile: string | undefined
): WorkflowAutomaton | undefined {
  return readWorkflowAutomaton(latestPath(baseDir, profile));
}

export function listPeerWorkflowAutomata(
  baseDir: string,
  activeProfile: string | undefined
): WorkflowAutomaton[] {
  const dir = persistenceDir(baseDir);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.startsWith('latest-') && name.endsWith('.json'))
    .filter((name) => name !== `latest-${sanitizeProfile(activeProfile)}.json`)
    .map((name) => readWorkflowAutomaton(join(dir, name)))
    .filter((value): value is WorkflowAutomaton => Boolean(value));
}

export function persistWorkflowAutomatonSnapshot(
  baseDir: string,
  automaton: WorkflowAutomaton
): void {
  const dir = persistenceDir(baseDir);
  mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(automaton, null, 2);
  writeFileSync(historyPath(baseDir, automaton), payload, 'utf-8');
  writeFileSync(latestPath(baseDir, automaton.authProfile), payload, 'utf-8');
}
