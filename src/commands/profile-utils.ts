// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

/**
 * Sanitizes a user-supplied profile name into a safe, filesystem-friendly slug.
 * Returns 'user' if the input is empty or reduces to only separators.
 */
export function sanitizeProfileName(profileRaw: string | undefined): string {
  const raw = profileRaw?.trim() ?? '';
  if (raw === '') return 'user';

  const sanitized = raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^[-_]+|[-_]+$/g, '');

  return sanitized === '' ? 'user' : sanitized;
}
