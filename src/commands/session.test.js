'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');
const { startSession, makeTurn } = require('../helpers/turn-fixtures');
const { readSessionMeta } = require('../session');
const { run } = require('./session');

function captureOutput(fn) {
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errs.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { logs: logs.join('\n'), errs: errs.join('\n') };
}

// process.exit(1) in run()'s error paths would kill the whole test process
// if called for real — stub it to throw instead, so the error path returns
// control to the test without exiting node:test itself.
function withExitStub(fn) {
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__exit_stub__'); };
  try {
    const result = captureOutput(() => {
      try { fn(); } catch (e) { if (e.message !== '__exit_stub__') throw e; }
    });
    return { ...result, exitCode };
  } finally {
    process.exit = origExit;
  }
}

describe('session command', () => {
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

  test('session new starts a fresh session with forked_from: null', () => {
    const { logs } = captureOutput(() => run(['new']));
    assert.match(logs, /Started session: [0-9a-f-]{36}/);

    const sessionId = logs.match(/Started session: ([0-9a-f-]{36})/)[1];
    const meta = readSessionMeta(sessionId);
    assert.ok(meta, 'meta ref should exist for the new session');
    assert.equal(meta.forked_from, null);
  });

  test('session new --from <session_id>:<turn_n> records forked_from lineage', () => {
    const parent = startSession();
    makeTurn(parent, 'v1', git);
    makeTurn(parent, 'v2', git);

    const { logs } = captureOutput(() => run(['new', '--from', `${parent.session_id}:2`]));
    assert.match(logs, /Forked from: .+ turn 2/);

    const childId = logs.match(/Started session: ([0-9a-f-]{36})/)[1];
    const meta = readSessionMeta(childId);
    assert.deepEqual(meta.forked_from, { session_id: parent.session_id, turn_n: 2 });
  });

  test('session new --from rejects a turn that does not exist', () => {
    const parent = startSession();
    makeTurn(parent, 'v1', git);

    const { errs, exitCode } = withExitStub(() => run(['new', '--from', `${parent.session_id}:99`]));
    assert.match(errs, /turn 99 not found/);
    assert.equal(exitCode, 1);
  });

  test('session new --from rejects a malformed argument', () => {
    const { errs, exitCode } = withExitStub(() => run(['new', '--from', 'not-a-valid-arg']));
    assert.match(errs, /requires <session_id>:<turn_n>/);
    assert.equal(exitCode, 1);
  });

  test('session list shows all sessions with turn counts, marking the current one', () => {
    const s1 = startSession();
    makeTurn(s1, 'a', git);
    makeTurn(s1, 'b', git);

    const s2 = startSession();
    makeTurn(s2, 'c', git);

    const { logs } = captureOutput(() => run(['list']));
    assert.match(logs, new RegExp(`\\* ${s2.session_id}\\s+\\(1 turn\\)`), 'current session marked with *');
    assert.match(logs, new RegExp(`  ${s1.session_id}\\s+\\(2 turns\\)`), 'prior session listed without marker');
  });

  test('session list shows forked_from lineage for a forked session', () => {
    const parent = startSession();
    makeTurn(parent, 'v1', git);

    run(['new', '--from', `${parent.session_id}:1`]);

    const { logs } = captureOutput(() => run(['list']));
    assert.match(logs, new RegExp(`forked from ${parent.session_id} turn 1`));
  });

  test('session list reports no sessions when none exist', () => {
    const { logs } = captureOutput(() => run(['list']));
    assert.match(logs, /No sessions found\./);
  });

  test('unknown subcommand prints usage and exits nonzero', () => {
    const { errs, exitCode } = withExitStub(() => run(['bogus']));
    assert.match(errs, /Usage: git turn session/);
    assert.equal(exitCode, 1);
  });
});
