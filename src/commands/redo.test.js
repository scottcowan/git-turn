'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');
const { snapshotWorktree, updateRef } = require('../git');
const { newSession, incrementTurn, turnRef, ensureDirs } = require('../session');
const { run: revertRun } = require('./revert');
const { run: redoRun } = require('./redo');

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

describe('redo command', () => {
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

  test('restores pre-revert state after revert (D-02)', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    revertRun(['1']);

    // After revert, file should be v1
    const afterRevert = readFileSync(join(process.cwd(), 'work.txt'), 'utf8').trim();
    assert.equal(afterRevert, 'v1');

    redoRun([]);

    // After redo, file should be back to pre-revert state (v2)
    const afterRedo = readFileSync(join(process.cwd(), 'work.txt'), 'utf8').trim();
    assert.equal(afterRedo, 'v2', 'redo must restore the pre-revert state (v2)');
  });

  test('exits 1 with nothing to redo when no revert in op log', () => {
    makeTurn(session, 'v1', git);

    let exitCode = null;
    const origExit = process.exit;
    process.exit = (code) => { exitCode = code; throw new Error('process.exit:' + code); };
    try {
      redoRun([]);
    } catch (e) {
      // expected
    } finally {
      process.exit = origExit;
    }
    assert.equal(exitCode, 1, 'redo with no prior revert must exit 1 with "nothing to redo"');
  });

  test('second redo fails after first redo succeeds (op consumed)', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    revertRun(['1']);

    // First redo should succeed
    redoRun([]);

    // Second redo should fail — op consumed
    let exitCode = null;
    const origExit = process.exit;
    process.exit = (code) => { exitCode = code; throw new Error('process.exit:' + code); };
    try {
      redoRun([]);
    } catch (e) {
      // expected
    } finally {
      process.exit = origExit;
    }
    assert.equal(exitCode, 1, 'second redo must exit 1 after op is consumed');
  });
});
