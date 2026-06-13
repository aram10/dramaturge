// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

// Enforces Conventional Commits, which drive release-please versioning.
// See: https://www.conventionalcommits.org/
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'perf', 'ci', 'build', 'revert'],
    ],
  },
};
