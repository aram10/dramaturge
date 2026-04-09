// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import {
  parseJsoncObject as parseJsoncObjectShared,
  stripJsonComments as stripJsonCommentsShared,
} from './jsonc.shared.js';

export function stripJsonComments(input: string): string {
  return stripJsonCommentsShared(input);
}

export function parseJsoncObject(raw: string): unknown {
  return parseJsoncObjectShared(raw);
}
