#!/usr/bin/env node
// Opt-in auto-commit/push after a successful build.
//
// Deliberately conservative: it stages ONLY files git already tracks (`git add -u`),
// so a new untracked secret (credentials.json, .env.local.bak, a dumped token) can
// never be swept into this public repo by a build. New files stay a manual, reviewed
// `git add`. Off unless AUTO_PUBLISH=1, and refuses to push from any branch but main.
import { execFileSync } from 'node:child_process';

const run = (args) =>
  execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

if (process.env.AUTO_PUBLISH !== '1') {
  console.log('[auto-publish] skipped (set AUTO_PUBLISH=1 to enable)');
  process.exit(0);
}

try {
  const branch = run(['symbolic-ref', '--short', 'HEAD']);
  if (branch !== 'main') {
    console.log(`[auto-publish] skipped: on "${branch}", not main`);
    process.exit(0);
  }

  run(['add', '-u']); // tracked files only — never -A

  let hasStaged = false;
  try {
    run(['diff', '--cached', '--quiet']);
  } catch {
    hasStaged = true; // non-zero exit means there ARE staged changes
  }
  if (!hasStaged) {
    console.log('[auto-publish] nothing staged; skipped');
    process.exit(0);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  run(['commit', '-m', `chore: auto build ${stamp}`]);
  run(['push', 'origin', 'main']);
  console.log('[auto-publish] committed and pushed to origin/main');
} catch (err) {
  console.error('[auto-publish] failed:', err.message);
  process.exit(0); // never fail the build over publishing
}
