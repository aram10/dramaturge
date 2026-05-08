// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { createHash } from 'node:crypto';
import type { StateNode } from '../types.js';
import type { WorkflowState, WorkflowStateKey, WorkflowStateKind } from './types.js';

function collapseRouteSegment(segment: string): string {
  if (/^\d+$/.test(segment)) {
    return ':id';
  }
  if (/^[0-9a-f]{8,}$/i.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment)) {
    return ':id';
  }
  return segment.toLowerCase();
}

export function collapseRouteFamily(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const [pathname] = path.split('?');
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => collapseRouteSegment(segment));
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

function normalizeHeading(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed.replace(/\s+/g, ' ') : undefined;
}

function buildFormSignature(node: StateNode): string | undefined {
  const markers = node.fingerprint.signature.uiMarkers
    .filter((marker) => /(input|field|form|textarea|select|error|invalid|required)/i.test(marker))
    .slice(0, 6)
    .sort();
  return markers.length > 0 ? markers.join('|') : undefined;
}

function buildControlSignature(node: StateNode): string | undefined {
  const controls = Array.from(new Set([...node.controlsDiscovered, ...node.controlsExercised]))
    .slice(0, 8)
    .sort();
  return controls.length > 0 ? controls.join('|') : undefined;
}

function inferStateKind(node: StateNode, authProfile: string | undefined): WorkflowStateKind {
  const routeFamily = collapseRouteFamily(node.fingerprint.normalizedPath ?? node.url);
  const heading = normalizeHeading(node.fingerprint.heading || node.title);
  const dialog = normalizeHeading(node.fingerprint.dialogTitles[0]);
  const text = [routeFamily, heading, dialog].filter(Boolean).join(' ');

  if (dialog && /(are you sure|confirm|confirmation|delete)/i.test(dialog)) {
    return 'confirmation';
  }
  if (/(success|complete|completed|thank you|saved)/i.test(text)) {
    return 'success';
  }
  if (/(error|invalid|forbidden|denied|failed)/i.test(text)) {
    return 'error';
  }
  if (node.pageType === 'auth' || /login|signin|sign-in/.test(text)) {
    return authProfile ? 'authenticated' : 'unauthenticated';
  }
  switch (node.pageType) {
    case 'list':
      return 'list';
    case 'detail':
      return 'detail';
    case 'form':
      return 'form';
    case 'wizard':
      return 'wizard-step';
    case 'modal':
      return 'modal';
    default:
      return authProfile ? 'authenticated' : 'unknown';
  }
}

function buildEntityHints(node: StateNode, routeFamily: string | undefined): string[] {
  const routeTokens = (routeFamily ?? '')
    .split('/')
    .filter(Boolean)
    .filter((token) => !token.startsWith(':'));
  const headingTokens = normalizeHeading(node.fingerprint.heading)
    ?.split(' ')
    .filter((token) => token.length > 2)
    .slice(0, 4);
  return Array.from(new Set([...routeTokens, ...(headingTokens ?? [])])).slice(0, 6);
}

export function buildWorkflowStateKey(
  node: StateNode,
  authProfile: string | undefined,
  includeAuthProfile: boolean
): WorkflowStateKey {
  const routeFamily = collapseRouteFamily(node.fingerprint.normalizedPath ?? node.url);
  return {
    authProfile: includeAuthProfile ? authProfile : undefined,
    routeFamily,
    pageType: node.pageType,
    modalLabel: normalizeHeading(node.fingerprint.dialogTitles[0]),
    formSignature: buildFormSignature(node),
    entityStateHint: buildEntityHints(node, routeFamily).join('|') || undefined,
    dominantHeading: normalizeHeading(node.fingerprint.heading || node.title),
    controlClusterSignature: buildControlSignature(node),
  };
}

export function workflowStateKeyId(key: WorkflowStateKey): string {
  const hash = createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 12);
  return `wf-state-${hash}`;
}

function buildStateLabel(
  key: WorkflowStateKey,
  kind: WorkflowStateKind,
  authProfile: string | undefined
): string {
  const parts = [
    authProfile ? `role:${authProfile}` : undefined,
    kind,
    key.routeFamily,
    key.modalLabel,
    key.dominantHeading,
  ].filter((value): value is string => Boolean(value));
  return parts.join(' · ');
}

export function createWorkflowState(
  node: StateNode,
  authProfile: string | undefined,
  includeAuthProfile: boolean
): WorkflowState {
  const key = buildWorkflowStateKey(node, authProfile, includeAuthProfile);
  const kind = inferStateKind(node, authProfile);
  const timestamp = node.firstSeenAt ?? new Date().toISOString();
  return {
    id: workflowStateKeyId(key),
    key,
    label: buildStateLabel(key, kind, includeAuthProfile ? authProfile : undefined),
    kind,
    routeFamily: key.routeFamily,
    pageType: key.pageType,
    authProfile: key.authProfile,
    modalLabel: key.modalLabel,
    formSignature: key.formSignature,
    entityHints: buildEntityHints(node, key.routeFamily),
    controlSignature: key.controlClusterSignature,
    sourceNodeIds: [node.id],
    firstObservedAt: timestamp,
    lastObservedAt: timestamp,
    observationCount: Math.max(node.timesVisited, 1),
    confidence: 0.35,
  };
}
