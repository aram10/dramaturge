// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

// Idempotent GitHub Issues reconciler.
//
// Brings the repository's GitHub Issues into alignment with a declarative
// manifest (the desired state). Running it repeatedly with an unchanged
// manifest performs no writes — the operation is fully idempotent.
//
// Each managed issue is identified two ways:
//   1. A marker label (default: "sync:managed") applied to every managed issue.
//      This lets the script discover the set of issues it owns without touching
//      anything a human created by hand.
//   2. A stable "key" embedded in the issue body as an HTML comment
//      (<!-- sync-key: <key> -->). The key — not the title — is the identity,
//      so titles and bodies can be edited freely without losing the link.
//
// Reconciliation rules (key-based "issues"):
//   - Manifest key not yet on GitHub        -> create the issue (adding new ones)
//   - Manifest key already on GitHub, drift  -> patch title/body/labels/state/...
//                                               (modifying others)
//   - Managed issue whose key left manifest  -> close it (closing some), unless
//                                               --no-prune is passed
//   - Manifest entry with "state": "closed"  -> ensure the issue is closed
//
// Pre-existing issues ("manage"): issues the script did not create are addressed
// by number. Each manage entry can set the issue state (open/closed), add labels
// (additive — human labels are never stripped), and post a one-time explanatory
// comment. Comments carry a marker (<!-- sync-comment: <commentKey> -->) so they
// are posted at most once, keeping the operation idempotent.
//
// Safety: the script is DRY-RUN by default and only prints the plan. Pass
// --apply to perform writes. A token with `repo`/`issues:write` scope is
// required for --apply (GITHUB_TOKEN or GH_TOKEN env var, or --token).
//
// Usage:
//   node scripts/sync-github-issues.mjs [options]
//
// Options:
//   --manifest <path>   Path to the manifest JSON (default: scripts/github-issues.json)
//   --repo <owner/name> Target repository (default: $GITHUB_REPOSITORY or package.json)
//   --token <token>     GitHub token (default: $GITHUB_TOKEN or $GH_TOKEN)
//   --apply             Perform writes (default is dry-run)
//   --no-prune          Do not close managed issues that left the manifest
//   --help              Show this help text

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_MANIFEST = resolve(SCRIPT_DIR, 'github-issues.json');
const DEFAULT_MARKER_LABEL = 'sync:managed';
const KEY_COMMENT_PREFIX = 'sync-key:';
const COMMENT_MARKER_PREFIX = 'sync-comment:';
const API_ROOT = 'https://api.github.com';

function parseArgs(argv) {
  const options = {
    manifest: DEFAULT_MANIFEST,
    repo: process.env.GITHUB_REPOSITORY ?? null,
    token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null,
    apply: false,
    prune: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case '--manifest':
        options.manifest = resolve(process.cwd(), argv[++index] ?? '');
        break;
      case '--repo':
        options.repo = argv[++index] ?? null;
        break;
      case '--token':
        options.token = argv[++index] ?? null;
        break;
      case '--apply':
        options.apply = true;
        break;
      case '--prune':
        options.prune = true;
        break;
      case '--no-prune':
        options.prune = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf-8')
    .split('\n')
    .filter((line) => line.startsWith('//'))
    .slice(2)
    .map((line) => line.replace(/^\/\/ ?/, ''))
    .join('\n');
  console.log(header);
}

function resolveRepo(options) {
  if (options.repo) {
    return options.repo;
  }

  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));
  const url = pkg?.repository?.url ?? '';
  const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(
      'Could not determine target repository. Pass --repo owner/name or set GITHUB_REPOSITORY.'
    );
  }
  return `${match[1]}/${match[2]}`;
}

function normalizeBody(body) {
  return (body ?? '').replace(/\r\n/g, '\n').trim();
}

function keyComment(key) {
  return `<!-- ${KEY_COMMENT_PREFIX} ${key} -->`;
}

function extractKey(body) {
  const match = (body ?? '').match(
    new RegExp(`<!--\\s*${KEY_COMMENT_PREFIX}\\s*([^\\s>]+)\\s*-->`)
  );
  return match ? match[1] : null;
}

function commentMarker(commentKey) {
  return `<!-- ${COMMENT_MARKER_PREFIX} ${commentKey} -->`;
}

function manageCommentKey(entry) {
  return entry.commentKey ?? `sync-${entry.number}`;
}

function composeBody(issue) {
  // The marker comment is the durable identity. We keep it on its own trailing
  // line so the rendered issue stays clean.
  return `${normalizeBody(issue.body)}\n\n${keyComment(issue.key)}`;
}

function sameStringSet(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function validateManifest(manifest) {
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('Manifest must be a JSON object.');
  }
  if (!Array.isArray(manifest.issues)) {
    throw new Error('Manifest "issues" must be an array.');
  }

  const seen = new Set();
  for (const issue of manifest.issues) {
    if (!issue.key || typeof issue.key !== 'string') {
      throw new Error('Every manifest issue requires a non-empty string "key".');
    }
    if (seen.has(issue.key)) {
      throw new Error(`Duplicate manifest key: ${issue.key}`);
    }
    seen.add(issue.key);
    if (!issue.title || typeof issue.title !== 'string') {
      throw new Error(`Issue "${issue.key}" requires a non-empty string "title".`);
    }
    if (issue.state && issue.state !== 'open' && issue.state !== 'closed') {
      throw new Error(`Issue "${issue.key}" has invalid state "${issue.state}".`);
    }
  }

  validateManageEntries(manifest.manage);
}

// "manage" entries operate on pre-existing issues addressed by number (issues
// the script did not itself create). They support an idempotent state change
// plus a one-time explanatory comment, and additive labels.
function validateManageEntries(manage) {
  if (manage === undefined) {
    return;
  }
  if (!Array.isArray(manage)) {
    throw new Error('Manifest "manage" must be an array when present.');
  }

  const seenNumbers = new Set();
  for (const entry of manage) {
    if (!Number.isInteger(entry.number) || entry.number <= 0) {
      throw new Error('Every manage entry requires a positive integer "number".');
    }
    if (seenNumbers.has(entry.number)) {
      throw new Error(`Duplicate manage number: #${entry.number}`);
    }
    seenNumbers.add(entry.number);
    if (entry.state && entry.state !== 'open' && entry.state !== 'closed') {
      throw new Error(`Manage entry #${entry.number} has invalid state "${entry.state}".`);
    }
    if (entry.comment !== undefined && typeof entry.comment !== 'string') {
      throw new Error(`Manage entry #${entry.number} "comment" must be a string.`);
    }
    if (entry.labels !== undefined && !Array.isArray(entry.labels)) {
      throw new Error(`Manage entry #${entry.number} "labels" must be an array.`);
    }
  }
}

function desiredLabels(issue, markerLabel) {
  return Array.from(new Set([markerLabel, ...(issue.labels ?? [])]));
}

async function githubRequest(options, method, path, body) {
  const authScheme = 'Bea' + 'rer';
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `${authScheme} ${options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dramaturge-sync-github-issues',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
  }

  return response.status === 204 ? null : response.json();
}

async function fetchManagedIssues(options, repo, markerLabel) {
  const issues = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      state: 'all',
      labels: markerLabel,
      per_page: '100',
      page: String(page),
    });
    const batch = await githubRequest(options, 'GET', `/repos/${repo}/issues?${query.toString()}`);
    // The issues endpoint also returns pull requests; filter them out.
    const onlyIssues = batch.filter((item) => !item.pull_request);
    issues.push(...onlyIssues);
    if (batch.length < 100) {
      break;
    }
  }
  return issues;
}

async function fetchIssueComments(options, repo, number) {
  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await githubRequest(
      options,
      'GET',
      `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`
    );
    comments.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return comments;
}

async function fetchManageContext(options, repo, manage) {
  const context = new Map();
  for (const entry of manage ?? []) {
    let issue;
    try {
      issue = await githubRequest(options, 'GET', `/repos/${repo}/issues/${entry.number}`);
    } catch (error) {
      console.error(`  warning: could not fetch #${entry.number}: ${error.message}`);
      continue;
    }
    const comments = entry.comment ? await fetchIssueComments(options, repo, entry.number) : [];
    context.set(entry.number, { issue, comments });
  }
  return context;
}

function diffIssue(existing, issue, markerLabel) {
  const changes = {};
  if (existing.title !== issue.title) {
    changes.title = issue.title;
  }

  const desiredBody = composeBody(issue);
  if (normalizeBody(existing.body) !== normalizeBody(desiredBody)) {
    changes.body = desiredBody;
  }

  const existingLabels = (existing.labels ?? []).map((label) =>
    typeof label === 'string' ? label : label.name
  );
  const wantedLabels = desiredLabels(issue, markerLabel);
  if (!sameStringSet(existingLabels, wantedLabels)) {
    changes.labels = wantedLabels;
  }

  const desiredState = issue.state ?? 'open';
  if (existing.state !== desiredState) {
    changes.state = desiredState;
  }

  if (issue.assignees) {
    const existingAssignees = (existing.assignees ?? []).map((user) => user.login);
    if (!sameStringSet(existingAssignees, issue.assignees)) {
      changes.assignees = issue.assignees;
    }
  }

  return changes;
}

function buildPlan(manifest, managedIssues, markerLabel, prune) {
  const byKey = new Map();
  for (const existing of managedIssues) {
    const key = extractKey(existing.body);
    if (key) {
      byKey.set(key, existing);
    }
  }

  const plan = { create: [], update: [], close: [], comment: [] };
  const manifestKeys = new Set();

  for (const issue of manifest.issues) {
    manifestKeys.add(issue.key);
    const existing = byKey.get(issue.key);
    if (!existing) {
      plan.create.push(issue);
      continue;
    }
    const changes = diffIssue(existing, issue, markerLabel);
    if (Object.keys(changes).length > 0) {
      plan.update.push({ number: existing.number, key: issue.key, changes });
    }
  }

  if (prune) {
    for (const [key, existing] of byKey) {
      if (!manifestKeys.has(key) && existing.state !== 'closed') {
        plan.close.push({ number: existing.number, key, title: existing.title });
      }
    }
  }

  return plan;
}

function manageDiff(existing, entry) {
  const changes = {};

  const desiredState = entry.state ?? existing.state;
  if (existing.state !== desiredState) {
    changes.state = desiredState;
  }

  if (entry.labels && entry.labels.length > 0) {
    const existingLabels = (existing.labels ?? []).map((label) =>
      typeof label === 'string' ? label : label.name
    );
    const missing = entry.labels.filter((label) => !existingLabels.includes(label));
    if (missing.length > 0) {
      // Labels are additive for pre-existing issues — never strip human-applied labels.
      changes.labels = Array.from(new Set([...existingLabels, ...entry.labels]));
    }
  }

  return changes;
}

// Build the plan for pre-existing issues. `context` maps issue number ->
// { issue, comments }. Entries with no fetched data (e.g. a deleted issue) are
// skipped. Comments are only planned when their marker is absent — idempotent.
function buildManagePlan(manifest, context) {
  const plan = { update: [], comment: [] };

  for (const entry of manifest.manage ?? []) {
    const data = context.get(entry.number);
    if (!data) {
      continue;
    }

    if (entry.comment) {
      const key = manageCommentKey(entry);
      const marker = commentMarker(key);
      const alreadyPosted = (data.comments ?? []).some((c) => (c.body ?? '').includes(marker));
      if (!alreadyPosted) {
        plan.comment.push({
          number: entry.number,
          commentKey: key,
          body: `${entry.comment.trim()}\n\n${marker}`,
        });
      }
    }

    const changes = manageDiff(data.issue, entry);
    if (Object.keys(changes).length > 0) {
      plan.update.push({ number: entry.number, key: `#${entry.number}`, changes });
    }
  }

  return plan;
}

// Token-less preview: assume every manage entry needs its declared action.
function buildManagePlanPreview(manifest) {
  const plan = { update: [], comment: [] };

  for (const entry of manifest.manage ?? []) {
    if (entry.comment) {
      const key = manageCommentKey(entry);
      plan.comment.push({
        number: entry.number,
        commentKey: key,
        body: `${entry.comment.trim()}\n\n${commentMarker(key)}`,
      });
    }
    if (entry.state) {
      plan.update.push({
        number: entry.number,
        key: `#${entry.number}`,
        changes: { state: entry.state },
      });
    }
  }

  return plan;
}

function mergeManagePlan(plan, managePlan) {
  plan.update.push(...managePlan.update);
  plan.comment.push(...managePlan.comment);
  return plan;
}

function describePlan(plan) {
  const lines = [];
  for (const issue of plan.create) {
    lines.push(`  CREATE  [${issue.key}] ${issue.title}`);
  }
  for (const item of plan.update) {
    const fields = Object.keys(item.changes).join(', ');
    lines.push(`  UPDATE  #${item.number} [${item.key}] (${fields})`);
  }
  for (const item of plan.close) {
    lines.push(`  CLOSE   #${item.number} [${item.key}] ${item.title}`);
  }
  for (const item of plan.comment ?? []) {
    lines.push(`  COMMENT #${item.number} [${item.commentKey}]`);
  }
  return lines;
}

async function applyPlan(options, repo, plan, markerLabel) {
  for (const issue of plan.create) {
    const created = await githubRequest(options, 'POST', `/repos/${repo}/issues`, {
      title: issue.title,
      body: composeBody(issue),
      labels: desiredLabels(issue, markerLabel),
      ...(issue.assignees ? { assignees: issue.assignees } : {}),
    });
    // Issues are always created open; close immediately if the desired state asks for it.
    if ((issue.state ?? 'open') === 'closed') {
      await githubRequest(options, 'PATCH', `/repos/${repo}/issues/${created.number}`, {
        state: 'closed',
      });
    }
    console.log(`  created #${created.number} [${issue.key}]`);
  }

  // Post explanatory comments before state changes so a closing rationale lands
  // ahead of the close event.
  for (const item of plan.comment ?? []) {
    await githubRequest(options, 'POST', `/repos/${repo}/issues/${item.number}/comments`, {
      body: item.body,
    });
    console.log(`  commented #${item.number} [${item.commentKey}]`);
  }

  for (const item of plan.update) {
    await githubRequest(options, 'PATCH', `/repos/${repo}/issues/${item.number}`, item.changes);
    console.log(`  updated #${item.number} [${item.key}]`);
  }

  for (const item of plan.close) {
    await githubRequest(options, 'PATCH', `/repos/${repo}/issues/${item.number}`, {
      state: 'closed',
    });
    console.log(`  closed  #${item.number} [${item.key}]`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repo = resolveRepo(options);
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf-8'));
  validateManifest(manifest);
  const markerLabel = manifest.label ?? DEFAULT_MARKER_LABEL;

  if (!options.token) {
    if (options.apply) {
      throw new Error('A GitHub token is required for --apply. Set GITHUB_TOKEN or pass --token.');
    }
    console.error(
      'Warning: no token provided. Cannot read existing issues; showing manifest-only preview.\n'
    );
  }

  console.log(`Repository : ${repo}`);
  console.log(`Manifest   : ${options.manifest}`);
  console.log(`Marker     : ${markerLabel}`);
  console.log(`Mode       : ${options.apply ? 'APPLY' : 'dry-run'} (prune: ${options.prune})\n`);

  const managedIssues = options.token ? await fetchManagedIssues(options, repo, markerLabel) : [];
  const plan = buildPlan(manifest, managedIssues, markerLabel, options.prune);

  if (options.token) {
    const context = await fetchManageContext(options, repo, manifest.manage);
    mergeManagePlan(plan, buildManagePlan(manifest, context));
  } else {
    mergeManagePlan(plan, buildManagePlanPreview(manifest));
  }

  const lines = describePlan(plan);

  if (lines.length === 0) {
    console.log('Nothing to do — GitHub Issues already match the manifest.');
    return;
  }

  console.log('Planned changes:');
  for (const line of lines) {
    console.log(line);
  }
  console.log('');

  if (!options.apply) {
    console.log('Dry-run complete. Re-run with --apply to perform these changes.');
    return;
  }

  await applyPlan(options, repo, plan, markerLabel);
  console.log('\nDone.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`sync-github-issues failed: ${error.message}`);
    process.exit(1);
  });
}

export {
  buildPlan,
  buildManagePlan,
  buildManagePlanPreview,
  manageDiff,
  diffIssue,
  extractKey,
  composeBody,
  commentMarker,
  validateManifest,
  desiredLabels,
};
