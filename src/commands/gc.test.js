'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');
const { updateRef, listRefs } = require('../git');
const { newSession, turnRef, ensureDirs, writeSession } = require('../session');
const crypto = require('crypto');

// Epoch counter ensures distinct creatordate values across makeSessionRefs calls
let epochBase = Math.floor(Date.now() / 1000) - 10000;

// Create N turn refs for a given sessionId using actual commits with explicit timestamps.
// epochOffset is added per session so each session's commits have distinct creatordate values.
// git helper from makeTestRepo supports opts.env to override environment variables.
function makeSessionRefs(sessionId, turnCount, git, dir) {
  epochBase += 100; // advance time by 100 seconds per session
  for (let n = 1; n <= turnCount; n++) {
    const ts = (epochBase + n) + ' +0000';
    git(['commit', '--allow-empty', '-m', 'session ' + sessionId.slice(0, 8) + ' turn ' + n], {
      env: { ...process.env, HOME: dir, GIT_COMMITTER_DATE: ts, GIT_AUTHOR_DATE: ts },
    });
    const sha = git(['rev-parse', 'HEAD']);
    updateRef(turnRef(sessionId, n), sha);
  }
}

describe('gc command', () => {
  let repoDir;
  let origCwd;
  let git;
  let session;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    repoDir = repo.dir;
    git = repo.git;
    process.chdir(repoDir);
    ensureDirs();
    session = newSession();
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  test('does nothing when session count is at or below keepN', () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    makeSessionRefs(idA, 1, git, repoDir);
    makeSessionRefs(idB, 1, git, repoDir);

    const { run } = require('./gc');
    run(['--keep-sessions', '3']);

    const refsA = listRefs('refs/git-turn/sessions/' + idA + '/');
    const refsB = listRefs('refs/git-turn/sessions/' + idB + '/');
    assert.equal(refsA.length, 1, 'session A refs must still exist');
    assert.equal(refsB.length, 1, 'session B refs must still exist');
  });

  test('prunes oldest sessions when count exceeds keepN (D-08, D-09)', () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();

    // Create sessions in order A -> B -> C (oldest first) with distinct timestamps
    makeSessionRefs(idA, 1, git, repoDir);
    makeSessionRefs(idB, 1, git, repoDir);
    makeSessionRefs(idC, 1, git, repoDir);

    const { run } = require('./gc');
    run(['--keep-sessions', '2']);

    // Oldest session (A) must be pruned
    const refsA = listRefs('refs/git-turn/sessions/' + idA + '/');
    assert.equal(refsA.length, 0, 'oldest session A must be pruned');

    // Newer sessions (B and C) must remain
    const refsB = listRefs('refs/git-turn/sessions/' + idB + '/');
    const refsC = listRefs('refs/git-turn/sessions/' + idC + '/');
    assert.ok(refsB.length > 0, 'session B must not be pruned');
    assert.ok(refsC.length > 0, 'session C must not be pruned');
  });

  test('never prunes current active session even if it is the oldest', () => {
    // Set current session to idA (oldest)
    const idA = session.session_id;
    makeSessionRefs(idA, 1, git, repoDir);

    // Create 10 more sessions so total is 11 (exceeds default keepN=10)
    for (let i = 0; i < 10; i++) {
      const id = crypto.randomUUID();
      makeSessionRefs(id, 1, git, repoDir);
    }

    const { run } = require('./gc');
    run([]); // default keepN=10

    // Current session (idA, oldest) must NOT be pruned
    const refsA = listRefs('refs/git-turn/sessions/' + idA + '/');
    assert.ok(refsA.length > 0, 'current session must never be pruned even when oldest');
  });

  test('prints gc hint after pruning (D-10)', () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();
    makeSessionRefs(idA, 1, git, repoDir);
    makeSessionRefs(idB, 1, git, repoDir);
    makeSessionRefs(idC, 1, git, repoDir);

    const logged = [];
    const origLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));
    try {
      const { run } = require('./gc');
      run(['--keep-sessions', '2']);
    } finally {
      console.log = origLog;
    }

    const output = logged.join('\n');
    assert.ok(
      output.includes("Snapshot objects will be reclaimed on next 'git gc'"),
      'gc hint must be printed when pruning occurs'
    );
  });

  test('does not print gc hint when nothing pruned', () => {
    const idA = crypto.randomUUID();
    makeSessionRefs(idA, 1, git, repoDir);

    const logged = [];
    const origLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));
    try {
      const { run } = require('./gc');
      run(['--keep-sessions', '10']);
    } finally {
      console.log = origLog;
    }

    const output = logged.join('\n');
    assert.ok(
      !output.includes('Snapshot objects will be reclaimed'),
      'gc hint must NOT be printed when nothing is pruned'
    );
  });
});
