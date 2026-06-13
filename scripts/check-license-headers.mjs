// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

// Guards against incompatible SPDX license headers re-entering the tree.
// The package is published under Apache-2.0 (see package.json + LICENSE), so a
// GPL-3.0-only header on any file that compiles into the tarball is a legal
// redistribution blocker. This check fails CI if a forbidden identifier appears.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FORBIDDEN_IDENTIFIERS = ['GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0'];

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files'], { encoding: 'utf-8' });
  return output.split('\n').filter(Boolean);
}

const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function main() {
  const offenders = [];
  for (const file of listTrackedFiles()) {
    if (!TEXT_EXTENSIONS.test(file)) {
      continue;
    }
    let contents;
    try {
      contents = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      if (contents.includes(`SPDX-License-Identifier: ${identifier}`)) {
        offenders.push(`${file}: ${identifier}`);
      }
    }
  }

  if (offenders.length > 0) {
    console.error(
      'Forbidden SPDX license headers found (package is Apache-2.0):\n' +
        offenders.map((o) => `  - ${o}`).join('\n')
    );
    process.exit(1);
  }

  console.log('License header check passed: no forbidden SPDX identifiers found.');
}

main();
