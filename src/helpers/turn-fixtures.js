'use strict';

const { writeFileSync } = require('fs');
const { join } = require('path');
const { snapshotWorktree, updateRef, headSha, currentBranch } = require('../git');
const { ensureDirs, newSession, incrementTurn, turnRef } = require('../session');

// startSession: ensures git-turn dirs exist, then starts a fresh session.
function startSession() {
  ensureDirs();
  return newSession();
}

// Build a snapshot commit message matching the post-commit hook's format
// (head/branch/created lines) so the ref-walk fallback in blame-util.js can
// parse head_sha/branch/ts from fixture-created snapshots exactly as it
// would from real hook-created ones. Optional `ts` lets heatmap fixtures
// place a turn on a specific calendar day; every existing call site omits
// it and keeps today's timestamp (backward compatible).
function snapshotMessage(session, head, label, ts) {
  return [
    label,
    `session ${session.session_id}`,
    `turn_n ${session.turn_n + 1}`,
    `trigger fixture`,
    `head ${head}`,
    `branch ${currentBranch()}`,
    `created ${ts || new Date().toISOString()}`,
  ].join('\n');
}

// makeTurn: writes content to a tracked file, commits, snapshots, updates
// turn ref and increments the session. Generalized with opts.file/opts.ts.
function makeTurn(session, content, git, opts = {}) {
  const file = opts.file || 'work.txt';
  writeFileSync(join(process.cwd(), file), content + '\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'turn ' + (session.turn_n + 1)]);
  const head = headSha();
  const { commitSha } = snapshotWorktree({ message: snapshotMessage(session, head, 'turn ' + (session.turn_n + 1), opts.ts) });
  incrementTurn(session);
  updateRef(turnRef(session.session_id, session.turn_n), commitSha);
  return { snapshotSha: commitSha, headSha: head, turn_n: session.turn_n };
}

// makeUntrackedTurn: writes content to a file WITHOUT staging it, advances
// HEAD with an empty commit, then snapshots — snapshotWorktree() picks the
// untracked file up via ls-files --others --exclude-standard, so the
// snapshot tree captures content the real commit graph never records.
function makeUntrackedTurn(session, content, git, opts = {}) {
  const file = opts.file || 'untracked.txt';
  writeFileSync(join(process.cwd(), file), content + '\n');
  git(['commit', '-q', '--allow-empty', '-m', 'turn ' + (session.turn_n + 1) + ' (untracked)']);
  const head = headSha();
  const label = 'turn ' + (session.turn_n + 1) + ' (untracked)';
  const { commitSha } = snapshotWorktree({ message: snapshotMessage(session, head, label, opts.ts) });
  incrementTurn(session);
  updateRef(turnRef(session.session_id, session.turn_n), commitSha);
  return { snapshotSha: commitSha, headSha: head, turn_n: session.turn_n };
}

module.exports = { startSession, makeTurn, makeUntrackedTurn };
