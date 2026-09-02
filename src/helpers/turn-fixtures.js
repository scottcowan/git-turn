'use strict';

const { writeFileSync } = require('fs');
const { join } = require('path');
const { snapshotWorktree, updateRef, headSha } = require('../git');
const { ensureDirs, newSession, incrementTurn, turnRef } = require('../session');

// startSession: ensures git-turn dirs exist, then starts a fresh session.
function startSession() {
  ensureDirs();
  return newSession();
}

// makeTurn: writes content to a tracked file, commits, snapshots, updates
// turn ref and increments the session. Mirrors the original revert.test.js
// helper verbatim, generalized with opts.file.
function makeTurn(session, content, git, opts = {}) {
  const file = opts.file || 'work.txt';
  writeFileSync(join(process.cwd(), file), content + '\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'turn ' + (session.turn_n + 1)]);
  const head = headSha();
  const { commitSha } = snapshotWorktree({ message: 'turn ' + (session.turn_n + 1) });
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
  const { commitSha } = snapshotWorktree({ message: 'turn ' + (session.turn_n + 1) + ' (untracked)' });
  incrementTurn(session);
  updateRef(turnRef(session.session_id, session.turn_n), commitSha);
  return { snapshotSha: commitSha, headSha: head, turn_n: session.turn_n };
}

module.exports = { startSession, makeTurn, makeUntrackedTurn };
