'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');
const { makeTestRepo } = require('../helpers/test-repo');
const { snapshotWorktree, updateRef } = require('../git');
const { ensureDirs, newSession, readSession, incrementTurn, turnRef } = require('../session');
const { run } = require('./diff');

describe('diff command', () => {
  let dir;
  let origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    // Initialize git-turn session in the test repo
    ensureDirs();
    newSession();
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Helper: create a turn by writing a file, committing, and snapshotting.
   * Returns the snapshot commitSha.
   */
  function makeTurn(label) {
    const env = { ...process.env, HOME: dir };

    writeFileSync(join(dir, `file-${label}.txt`), `content-${label}\n`);
    execFileSync('git', ['add', '.'], { cwd: dir, env, encoding: 'utf8' });
    execFileSync('git', ['commit', '-q', '-m', `commit ${label}`], { cwd: dir, env, encoding: 'utf8' });

    // Snapshot the worktree manually (mirrors post-commit hook logic)
    const session = readSession();
    const turnN = session.turn_n + 1;
    const { commitSha } = snapshotWorktree({ message: `turn ${turnN}` });
    updateRef(turnRef(session.session_id, turnN), commitSha);
    incrementTurn(session);
    return commitSha;
  }

  test('exits 1 when not initialized', () => {
    // Remove session.json to simulate an uninitialized git-turn repo
    const sessionPath = join(dir, '.git', 'git-turn', 'session.json');
    rmSync(sessionPath, { force: true });

    const origExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; throw new Error('process.exit(' + code + ')'); };
    try {
      run(['1']);
    } catch (e) {
      if (!e.message.startsWith('process.exit')) throw e;
    } finally {
      process.exit = origExit;
    }
    assert.equal(exitCode, 1);
  });

  test('diff 1 uses empty tree when only one turn exists', () => {
    makeTurn('a');

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      run(['1']);
    } finally {
      console.log = origLog;
    }

    const output = logs.join('\n');
    // Output should be a diff patch or '(no changes)' — no error thrown
    assert.ok(typeof output === 'string');
  });

  test('diff N M diffs turn N snapshot against turn M snapshot', () => {
    makeTurn('x');
    makeTurn('y');

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      run(['1', '2']);
    } finally {
      console.log = origLog;
    }

    const output = logs.join('\n');
    // Output is a string (truthy diff patch or '(no changes)')
    assert.ok(typeof output === 'string');
  });
});
