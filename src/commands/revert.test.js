'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');
const { snapshotWorktree, updateRef } = require('../git');
const { newSession, incrementTurn, turnRef, readOps, ensureDirs } = require('../session');
const { run } = require('./revert');

// makeTurn: writes content to work.txt, commits, snapshots, updates turn ref, increments session
function makeTurn(session, content, git) {
  writeFileSync(join(process.cwd(), 'work.txt'), content + '\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'turn ' + (session.turn_n + 1)]);
  const { commitSha } = snapshotWorktree({ message: 'turn ' + (session.turn_n + 1) });
  incrementTurn(session);
  updateRef(turnRef(session.session_id, session.turn_n), commitSha);
  return commitSha;
}

describe('revert command', () => {
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

  test('restores worktree to turn N content without changing HEAD (D-01)', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    const headBefore = git(['rev-parse', 'HEAD']);

    run(['1']);

    const content = readFileSync(join(process.cwd(), 'work.txt'), 'utf8').trim();
    assert.equal(content, 'v1');

    const headAfter = git(['rev-parse', 'HEAD']);
    assert.equal(headAfter, headBefore, 'HEAD must be unchanged after revert (D-01)');
  });

  test('writes pre_revert_snapshot_sha to op log before restoring', () => {
    makeTurn(session, 'v1', git);

    run(['1']);

    const ops = readOps();
    const revertOp = ops.find(op => op.type === 'revert');
    assert.ok(revertOp, 'revert op must exist in op log');
    assert.ok(revertOp.pre_revert_snapshot_sha, 'pre_revert_snapshot_sha must be set in revert op');
  });

  test('fails with branch mismatch when on different branch (D-03)', () => {
    makeTurn(session, 'v1', git);
    // Create a new branch — session.branch remains 'main' but HEAD is now on 'other'
    git(['checkout', '-b', 'other']);

    assert.throws(() => {
      run(['1']);
    }, /[Bb]ranch/);
  });
});
