'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');
const { makeTestRepo } = require('../helpers/test-repo');
const { startSession, makeTurn } = require('../helpers/turn-fixtures');
const { readOps } = require('../session');
const { bisectCore } = require('./bisect');

// orderByCommitTopology's rev-list ordering is only deterministic across
// commits with distinct (second-resolution) commit timestamps — confirmed
// empirically in 03-01-SUMMARY.md. Tests that assert a *specific* turn_n
// (rather than just result shape) must space fixture commits >1s apart.
function tick() {
  execFileSync('sleep', ['1.1']);
}

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

  // Adapted from status.test.js's captureStatus convention: run bisectCore
  // with an injected log sink instead of swapping console.log, since
  // bisectCore's `log` parameter is the sole output channel for progress
  // and the verdict.
  function captureBisect(overrides = {}) {
    const logs = [];
    const result = bisectCore({ cmd: 'true', log: m => logs.push(m), ...overrides });
    return { output: logs.join('\n'), result };
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

  test('binary-searches 7 candidates and finds turn 4 as the first failure', () => {
    for (let n = 1; n <= 3; n++) { makeTurn(session, 'ok-' + n, git); tick(); }
    for (let n = 4; n <= 7; n++) { makeTurn(session, 'bad-' + n, git); if (n < 7) tick(); }

    let calls = 0;
    const stub = () => {
      calls++;
      return { status: workContent().trim().startsWith('bad') ? 1 : 0 };
    };

    const { result } = captureBisect({ runCommand: stub });

    assert.equal(result.result, 'found');
    assert.equal(result.turn.turn_n, 4);
    assert.ok(calls <= 3, `expected at most 3 calls (log2(7) rounded up), got ${calls}`);
  });

  test('returns clean with tested reflecting the number of candidates actually run', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);
    makeTurn(session, 'v3', git);

    let calls = 0;
    const { result } = captureBisect({ runCommand: () => { calls++; return { status: 0 }; } });

    assert.equal(result.result, 'clean');
    assert.equal(result.tested, calls);
  });

  test('progress output has one testing line per tested candidate, each followed by PASS or FAIL', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);
    makeTurn(session, 'v3', git);

    const { output } = captureBisect({ runCommand: () => ({ status: 0 }) });
    const lines = output.split('\n');
    const testingCount = lines.filter(l => l.includes('testing...')).length;
    const verdictCount = lines.filter(l => l.trim() === 'PASS' || l.trim() === 'FAIL').length;

    assert.ok(testingCount > 0, 'expected at least one testing line');
    assert.equal(testingCount, verdictCount);
  });

  test('first output line is the Bisecting header naming the command', () => {
    makeTurn(session, 'v1', git);

    const { output } = captureBisect({ runCommand: () => ({ status: 0 }) });

    assert.match(output.split('\n')[0], /^Bisecting \d+ turns with: true$/);
  });

  test('last output line is always Restored pre-bisect state', () => {
    makeTurn(session, 'v1', git);

    const { output } = captureBisect({ runCommand: () => ({ status: 0 }) });
    const lines = output.split('\n');

    assert.equal(lines[lines.length - 1], 'Restored pre-bisect state');
  });

  test('verdict line names the failing turn on the found path', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    const { output, result } = captureBisect({ runCommand: () => ({ status: 1 }) });

    assert.match(output, /introduced the failure/);
    assert.ok(output.includes(String(result.turn.turn_n)));
  });

  test('verdict line reports the candidate count on the clean path', () => {
    makeTurn(session, 'v1', git);

    const { output } = captureBisect({ runCommand: () => ({ status: 0 }) });

    assert.match(output, /No failing turn found in/);
  });

  test('handles the boundary case where the oldest candidate already fails', () => {
    makeTurn(session, 'v1', git); tick();
    makeTurn(session, 'v2', git); tick();
    makeTurn(session, 'v3', git);

    const { result } = captureBisect({ runCommand: () => ({ status: 1 }) });

    assert.equal(result.result, 'found');
    assert.equal(result.turn.turn_n, 1);
  });

  test('a 125 exit is SKIP, not a failure', () => {
    makeTurn(session, 'v1', git);

    const { output, result } = captureBisect({ runCommand: () => ({ status: 125 }) });

    assert.match(output, /SKIP \(untestable, exit 125\)/);
    assert.notEqual(result.result, 'found');
  });

  test('an all-125 run returns all-skipped', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    const { output, result } = captureBisect({ runCommand: () => ({ status: 125 }) });

    assert.equal(result.result, 'all-skipped');
    assert.match(output, /All tested candidates were untestable \(exit 125\)/);
  });

  test('a 137 exit aborts the search immediately', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    const { output, result } = captureBisect({ runCommand: () => ({ status: 137 }) });

    assert.deepEqual(result, { result: 'aborted', code: 137 });
    assert.match(output, /Bisect aborted: command exited 137/);
  });

  test('a null status (killed by signal) also aborts, and the worktree is restored', () => {
    makeTurn(session, 'v1', git);
    const before = workContent();

    const { result } = captureBisect({ runCommand: () => ({ status: null }) });

    assert.equal(result.result, 'aborted');
    assert.equal(workContent(), before);
  });

  test('writes exactly one bisect-end op with a matching result and turn_n on the found path', () => {
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);

    const { result } = captureBisect({ runCommand: () => ({ status: 1 }) });

    const ends = readOps().filter(op => op.type === 'bisect-end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].result, result.result);
    assert.equal(ends[0].turn_n, result.turn.turn_n);
  });

  test('SIGINT listener count is higher during the search than before, and restored after bisectCore returns', () => {
    makeTurn(session, 'v1', git);
    const before = process.listenerCount('SIGINT');

    let during;
    captureBisect({
      runCommand: () => {
        during = process.listenerCount('SIGINT');
        return { status: 0 };
      },
    });

    assert.ok(during > before, `expected listener count during the search (${during}) > before (${before})`);
    assert.equal(process.listenerCount('SIGINT'), before);
  });
});
