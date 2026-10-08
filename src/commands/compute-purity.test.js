'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');

const PROBE_PATH = join(__dirname, '..', 'helpers', 'compute-purity-probe.js');
const BIN_PATH = join(__dirname, '..', '..', 'bin', 'git-turn');

describe('compute() cross-command purity + CLI end-to-end (REFACTOR-01, Phase 8 prerequisite)', () => {
  let dir, origCwd, origHome, repo, session, turn1, turn2;

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    process.env.HOME = dir;

    const { startSession, makeTurn } = require('../helpers/turn-fixtures');
    session = startSession();
    turn1 = makeTurn(session, 'a', repo.git);
    turn2 = makeTurn(session, 'b', repo.git);

    // Fresh pricing cache so cost's compute() never fetches over the
    // network (T-07-19).
    writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({
      _fetched_at: Date.now(),
      data: {},
    }));
  });

  afterEach(() => {
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  function runProbe(mode) {
    const stdout = execFileSync(process.execPath, [PROBE_PATH, mode], {
      cwd: dir,
      env: { ...process.env, HOME: dir, NO_COLOR: '1' },
      encoding: 'utf8',
    });
    return JSON.parse(stdout);
  }

  test('ready mode: every success and not-found-error case records zero sink calls', () => {
    const report = runProbe('ready');

    for (const entry of report) {
      assert.deepEqual(entry.calls, [], `${entry.cmd} ${JSON.stringify(entry.args)} recorded sink calls: ${JSON.stringify(entry.calls)}`);
    }
  });

  test('ready mode: success cases resolve ok with a string result; --json results parse', () => {
    const report = runProbe('ready');
    const successCmds = report.filter(e =>
      !(e.cmd === 'show' && e.args.includes('99')) &&
      !(e.cmd === 'diff' && (e.args.includes('abc') || e.args.includes('99'))) &&
      !(e.cmd === 'blame' && (e.args.length === 0 || e.args.includes('nonexistent.txt')))
    );

    assert.ok(successCmds.length > 0);
    for (const entry of successCmds) {
      assert.equal(entry.ok, true, `${entry.cmd} ${JSON.stringify(entry.args)} expected ok=true`);
      assert.equal(entry.resultType, 'string');
      if (entry.args.includes('--json')) {
        assert.equal(entry.jsonParses, true, `${entry.cmd} ${JSON.stringify(entry.args)} --json result failed to parse`);
      }
    }
  });

  test('ready mode: not-found error cases throw a real Error, not PROBE_EXIT', () => {
    const report = runProbe('ready');
    const errorCases = [
      { cmd: 'show', args: ['99'] },
      { cmd: 'diff', args: ['abc'] },
      { cmd: 'diff', args: ['99'] },
      { cmd: 'blame', args: [] },
      { cmd: 'blame', args: ['nonexistent.txt'] },
    ];

    for (const want of errorCases) {
      const entry = report.find(e => e.cmd === want.cmd && JSON.stringify(e.args) === JSON.stringify(want.args));
      assert.ok(entry, `missing report entry for ${want.cmd} ${JSON.stringify(want.args)}`);
      assert.equal(entry.ok, false);
      assert.equal(entry.errorIsError, true);
      assert.notEqual(entry.errorMessage, 'PROBE_EXIT');
    }
  });

  test('uninit mode: every not-initialized case records zero sink calls and throws a real Error', () => {
    const report = runProbe('uninit');

    assert.equal(report.length, 5);
    for (const entry of report) {
      assert.deepEqual(entry.calls, [], `${entry.cmd} recorded sink calls: ${JSON.stringify(entry.calls)}`);
      assert.equal(entry.ok, false);
      assert.equal(entry.errorIsError, true);
      assert.notEqual(entry.errorMessage, 'PROBE_EXIT');
      assert.match(entry.errorMessage, /not initialized/);
    }
  });

  describe('CLI end-to-end', () => {
    function snapRef(turnN) {
      return execFileSync('git', ['rev-parse', `refs/git-turn/sessions/${session.session_id}/turn-${turnN}`], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
    }

    test('diff 1 2 --plain stdout equals `git diff` of the same snapshot shas byte-for-byte', () => {
      const snap1 = snapRef(1);
      const snap2 = snapRef(2);

      const cliResult = spawnSync(process.execPath, [BIN_PATH, 'diff', '1', '2', '--plain'], {
        cwd: dir,
        env: { ...process.env, HOME: dir, NO_COLOR: '1' },
        encoding: 'utf8',
      });

      const gitDiff = execFileSync('git', ['diff', '--color=never', snap1, snap2], {
        cwd: dir,
        encoding: 'utf8',
      });

      assert.equal(cliResult.status, 0);
      assert.equal(cliResult.stdout, gitDiff.trim() + '\n');
    });

    test('diff 1 2 --json stdout parses as JSON with numeric added/removed', () => {
      const cliResult = spawnSync(process.execPath, [BIN_PATH, 'diff', '1', '2', '--json'], {
        cwd: dir,
        env: { ...process.env, HOME: dir, NO_COLOR: '1' },
        encoding: 'utf8',
      });

      assert.equal(cliResult.status, 0);
      const parsed = JSON.parse(cliResult.stdout);
      assert.equal(typeof parsed.added, 'number');
      assert.equal(typeof parsed.removed, 'number');
    });

    test('uninitialized repo: `log --json` exits 1, stdout parses to the not-initialized error object, stderr is empty', () => {
      const uninitDir = makeTestRepo().dir;
      try {
        const cliResult = spawnSync(process.execPath, [BIN_PATH, 'log', '--json'], {
          cwd: uninitDir,
          env: { ...process.env, HOME: uninitDir, NO_COLOR: '1' },
          encoding: 'utf8',
        });

        assert.equal(cliResult.status, 1);
        assert.deepEqual(JSON.parse(cliResult.stdout), {
          error: 'git turn: not initialized. Run `git turn init` first.',
        });
        assert.equal(cliResult.stderr, '');
      } finally {
        rmSync(uninitDir, { recursive: true, force: true });
      }
    });

    test('uninitialized repo: `log` (no --json) exits 1, stderr contains "not initialized", stdout empty', () => {
      const uninitDir = makeTestRepo().dir;
      try {
        const cliResult = spawnSync(process.execPath, [BIN_PATH, 'log'], {
          cwd: uninitDir,
          env: { ...process.env, HOME: uninitDir, NO_COLOR: '1' },
          encoding: 'utf8',
        });

        assert.equal(cliResult.status, 1);
        assert.match(cliResult.stderr, /not initialized/);
        assert.equal(cliResult.stdout, '');
      } finally {
        rmSync(uninitDir, { recursive: true, force: true });
      }
    });
  });
});
