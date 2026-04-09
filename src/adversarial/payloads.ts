// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

export interface AdversarialPayloadFamily {
  id: string;
  label: string;
  values: string[];
}

interface PayloadOptions {
  safeMode: boolean;
}

const SAFE_PAYLOAD_FAMILIES: AdversarialPayloadFamily[] = [
  {
    id: 'boundary-text',
    label: 'Boundary text',
    values: ['', ' ', 'A'.repeat(256), 'line-1\nline-2'],
  },
  {
    id: 'format-edge-cases',
    label: 'Format edge cases',
    values: ['00000000', '9999-12-31', 'not-an-email@', 'https://example.com/%2e%2e'],
  },
  {
    id: 'unicode-and-encoding',
    label: 'Unicode and encoding',
    values: ['naive café', 'zero-width\u200Bjoiner', '%252Fapi%252Fwidgets', '"quoted" value'],
  },
];

const UNSAFE_PAYLOAD_FAMILIES: AdversarialPayloadFamily[] = [
  {
    id: 'injection-probes',
    label: 'Injection probes',
    values: ['<script>alert(1)</script>', "' OR '1'='1", '{{7*7}}', '../../../../etc/passwd'],
  },
];

export function listAdversarialPayloadFamilies(
  options: PayloadOptions
): AdversarialPayloadFamily[] {
  return options.safeMode
    ? SAFE_PAYLOAD_FAMILIES
    : [...SAFE_PAYLOAD_FAMILIES, ...UNSAFE_PAYLOAD_FAMILIES];
}

export function summarizeAdversarialPayloadFamilies(options: PayloadOptions): string[] {
  return listAdversarialPayloadFamilies(options).map(
    (family) => `${family.id}: ${family.values.slice(0, 3).join(' | ')}`
  );
}
