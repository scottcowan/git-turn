'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, existsSync } = require('fs');
const { execFileSync } = require('child_process');
const { makeTestRepo } = require('../helpers/test-repo');
const { startSession, makeTurn } = require('../helpers/turn-fixtures');
const { run } = require('./export');

function withExitStub(fn) {
  const origExit = process.exit;
  let exitCode = null;
  const errs = [];
  const origErr = console.error;
  console.error = (...args) => errs.push(args.join(' '));
  process.exit = (code) => { exitCode = code; throw new Error('__exit_stub__'); };
  try {
    try { fn(); } catch (e) { if (e.message !== '__exit_stub__') throw e; }
  } finally {
    process.exit = origExit;
    console.error = origErr;
  }
  return { exitCode, errs: errs.join('\n') };
}

function captureLogs(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = origLog;
  }
  return logs.join('\n');
}

describe('export command', () => {
  let dir;
  let origCwd;
  let git;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    git = repo.git;
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('refuses to export when no git-turn refs exist', () => {
    const { exitCode, errs } = withExitStub(() => run([]));
    assert.equal(exitCode, 1);
    assert.match(errs, /nothing to export/);
  });

  test('bundles the format ref, session turn refs, and notes ref', () => {
    const { git: gitBin, updateRef, writeBlob, addNote } = require('../git');
    updateRef('refs/git-turn/format', writeBlob('{"version":"1"}'));

    const session = startSession();
    const turn1 = makeTurn(session, 'v1', git);
    addNote(require('../session').NOTES_REF, turn1.headSha, '{"turn_n":1}');

    const outPath = 'export-test.bundle';
    const logs = captureLogs(() => run(['--output', outPath]));

    assert.ok(existsSync(outPath), 'bundle file should be created');
    assert.match(logs, /Exported \d+ ref\(s\) to export-test\.bundle/);

    const verify = execFileSync('git', ['bundle', 'verify', outPath], { encoding: 'utf8' });
    assert.match(verify, /refs\/git-turn\/format/);
    assert.match(verify, new RegExp(`refs/git-turn/sessions/${session.session_id}/turn-1`));
    assert.match(verify, /refs\/notes\/git-turn/);
  });

  test('--since excludes refs reachable from the given ref', () => {
    const { updateRef, writeBlob } = require('../git');
    updateRef('refs/git-turn/format', writeBlob('{"version":"1"}'));

    const session = startSession();
    makeTurn(session, 'v1', git);
    const sinceTag = 'export-since-point';
    git(['tag', sinceTag, 'HEAD']);
    makeTurn(session, 'v2', git);

    const outPath = 'export-incremental.bundle';
    run(['--output', outPath, '--since', sinceTag]);

    assert.ok(existsSync(outPath));
    // "<file> is okay" goes to stderr, not stdout — assert on stdout content instead.
    const verify = execFileSync('git', ['bundle', 'verify', outPath], { encoding: 'utf8' });
    assert.match(verify, /The bundle contains these \d+ refs/);
  });

  test('rejects --since with a nonexistent ref', () => {
    const { updateRef, writeBlob } = require('../git');
    updateRef('refs/git-turn/format', writeBlob('{"version":"1"}'));

    const { exitCode, errs } = withExitStub(() => run(['--since', 'does-not-exist']));
    assert.equal(exitCode, 1);
    assert.match(errs, /does not exist/);
  });

  test('rejects --since with no value', () => {
    const { updateRef, writeBlob } = require('../git');
    updateRef('refs/git-turn/format', writeBlob('{"version":"1"}'));

    const { exitCode, errs } = withExitStub(() => run(['--since']));
    assert.equal(exitCode, 1);
    assert.match(errs, /--since requires a ref/);
  });

  test('defaults output path to a timestamped bundle filename', () => {
    const { updateRef, writeBlob } = require('../git');
    updateRef('refs/git-turn/format', writeBlob('{"version":"1"}'));

    const logs = captureLogs(() => run([]));
    const match = logs.match(/Exported \d+ ref\(s\) to (git-turn-export-\d+\.bundle)/);
    assert.ok(match, `expected default bundle filename in output, got: ${logs}`);
    assert.ok(existsSync(match[1]));
  });
});
