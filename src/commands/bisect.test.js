'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');
const { startSession, makeTurn } = require('../helpers/turn-fixtures');
const { readOps } = require('../session');
const { bisectCore } = require('./bisect');

describe('bisect command', () => {
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
    session = startSession();
  });

  afterEach(() => {
    require('../cache').closeDb();
    process.chdir(origCwd);
    rmSync(repoDir, { recursive: true, force: true });
  });

  function workContent() {
    return readFileSync(join(process.cwd(), 'work.txt'), 'utf8');
  }

  test('throws on dirty worktree and writes no bisect-start op (D-03)', () => {
    makeTurn(session, 'v1', git);
    writeFileSync(join(process.cwd(), 'work.txt'), 'dirty\n');

    assert.throws(() => {
      bisectCore({ cmd: 'true', log: () => {} });
    }, /clean worktree/);

    assert.equal(readOps().filter(op => op.type === 'bisect-start').length, 0);
  });

  test('throws when no candidate is reachable from HEAD', () => {
    makeTurn(session, 'v1', git);
    // An orphan branch shares no ancestry with the turn's head_sha, so no
    // candidate survives the isAncestor filter.
    git(['checkout', '--orphan', 'other']);
    git(['commit', '--allow-empty', '-q', '-m', 'orphan root']);

    assert.throws(() => {
      bisectCore({ cmd: 'true', log: () => {} });
    }, /no turn snapshots reachable from HEAD to bisect/);
  });

  test('restores worktree byte-identical after an all-pass run (D-04 path 1)', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);
    const before = workContent();

    const result = bisectCore({ cmd: 'true', log: () => {}, runCommand: () => ({ status: 0 }) });

    assert.equal(result.result, 'clean');
    assert.equal(workContent(), before);
  });

  test('restores worktree byte-identical after a run that finds a failure (D-04 path 2)', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);
    const before = workContent();

    const result = bisectCore({ cmd: 'true', log: () => {}, runCommand: () => ({ status: 1 }) });

    assert.equal(result.result, 'found');
    assert.equal(workContent(), before);
  });

  test('propagates a thrown runCommand error and still restores the worktree (D-04 path 3)', () => {
    makeTurn(session, 'v1', git);
    const before = workContent();

    assert.throws(() => {
      bisectCore({ cmd: 'true', log: () => {}, runCommand: () => { throw new Error('boom'); } });
    }, /boom/);

    assert.equal(workContent(), before);
  });

  test('writes a bisect-start op carrying cmd and pre_bisect_snapshot_sha', () => {
    makeTurn(session, 'v1', git);

    bisectCore({ cmd: 'true', log: () => {}, runCommand: () => ({ status: 0 }) });

    const op = readOps().find(o => o.type === 'bisect-start');
    assert.ok(op, 'bisect-start op must exist');
    assert.equal(op.cmd, 'true');
    assert.ok(op.pre_bisect_snapshot_sha, 'pre_bisect_snapshot_sha must be set');
  });

  test('tests exactly as many candidates as HEAD-reachable turns exist', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    let calls = 0;
    bisectCore({ cmd: 'true', log: () => {}, runCommand: () => { calls++; return { status: 0 }; } });

    assert.equal(calls, 2);
  });
});
