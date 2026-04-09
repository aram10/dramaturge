import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const DENYLIST = [
  {
    packageName: '@browserbasehq/stagehand',
    kind: 'exact',
    version: '3.0.4',
    reason: 'Known malicious release must never appear in the lockfile.',
  },
  {
    packageName: 'langsmith',
    kind: 'range',
    minInclusive: '0.3.41',
    maxExclusive: '0.4.6',
    reason: 'CVE-2026-25528 affects versions >=0.3.41 and <0.4.6.',
  },
];

function compareSemver(left, right) {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function parsePackageKey(key) {
  const base = key.split('(')[0] ?? key;
  const separator = base.lastIndexOf('@');
  if (separator <= 0) {
    return null;
  }

  return {
    packageName: base.slice(0, separator),
    version: base.slice(separator + 1),
  };
}

function violatesRule(version, rule) {
  if (rule.kind === 'exact') {
    return version === rule.version;
  }

  return (
    compareSemver(version, rule.minInclusive) >= 0 &&
    compareSemver(version, rule.maxExclusive) < 0
  );
}

const lockfile = parse(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf-8'));
const packageEntries = Object.keys(lockfile?.packages ?? {})
  .map((key) => parsePackageKey(key))
  .filter(Boolean);

const violations = [];
for (const rule of DENYLIST) {
  for (const entry of packageEntries) {
    if (entry.packageName !== rule.packageName) {
      continue;
    }

    if (violatesRule(entry.version, rule)) {
      violations.push(
        `${entry.packageName}@${entry.version} is denied: ${rule.reason}`
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Known-bad dependency versions detected:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Known-bad dependency denylist check passed.');
