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
const { compute } = require('./diff');
const { gitSafe, shouldColor } = require('../git');
const { EMPTY_TREE } = require('../diff-render');

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

  test('FORCE_COLOR emits ANSI-colored diff output', () => {
    makeTurn('x');
    makeTurn('y');

    const origForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      run(['1', '2']);
    } finally {
      console.log = origLog;
      if (origForceColor === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = origForceColor;
    }

    const output = logs.join('\n');
    assert.match(output, /\x1b\[/, 'FORCE_COLOR should produce ANSI escape codes in the diff');
  });

  test('NO_COLOR suppresses ANSI codes even when stdout would otherwise color', () => {
    makeTurn('x');
    makeTurn('y');

    const origNoColor = process.env.NO_COLOR;
    const origForceColor = process.env.FORCE_COLOR;
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1'; // NO_COLOR must win even if FORCE_COLOR is also set

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      run(['1', '2']);
    } finally {
      console.log = origLog;
      if (origNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNoColor;
      if (origForceColor === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForceColor;
    }

    const output = logs.join('\n');
    assert.doesNotMatch(output, /\x1b\[/, 'NO_COLOR must suppress ANSI codes regardless of FORCE_COLOR');
  });

  function withEnv(vars, fn) {
    const orig = {};
    for (const k of Object.keys(vars)) {
      orig[k] = process.env[k];
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    try {
      return fn();
    } finally {
      for (const k of Object.keys(vars)) {
        if (orig[k] === undefined) delete process.env[k];
        else process.env[k] = orig[k];
      }
    }
  }

  test('--plain byte-identical to inline gitSafe diff for two turns (default, FORCE_COLOR, NO_COLOR)', () => {
    const sha1 = makeTurn('x');
    const sha2 = makeTurn('y');

    for (const env of [{}, { FORCE_COLOR: '1', NO_COLOR: undefined }, { NO_COLOR: '1', FORCE_COLOR: undefined }]) {
      withEnv(env, () => {
        const colorArg = shouldColor() ? '--color=always' : '--color=never';
        const expected = gitSafe(['diff', colorArg, sha1, sha2]) || '(no changes)';
        assert.equal(compute(['1', '2', '--plain']), expected);
      });
    }
  });

  test('--plain single-turn equals inline gitSafe diff against EMPTY_TREE', () => {
    const sha1 = makeTurn('a');
    const colorArg = shouldColor() ? '--color=always' : '--color=never';
    const expected = gitSafe(['diff', colorArg, EMPTY_TREE, sha1]) || '(no changes)';
    assert.equal(compute(['1', '--plain']), expected);
  });

  test('rich default under NO_COLOR renders header, file, gutter row, no ANSI', () => {
    withEnv({ NO_COLOR: '1', FORCE_COLOR: undefined }, () => {
      makeTurn('x');
      makeTurn('y');
      const output = compute(['1', '2']);
      const lines = output.split('\n');
      assert.equal(lines[0], 'Added 1 / removed 0');
      assert.equal(lines[1], '');
      assert.match(output, /diff --git a\/file-y\.txt b\/file-y\.txt/);
      assert.match(output, /1 \+ content-y/);
      assert.doesNotMatch(output, /\x1b/);
    });
  });

  test('rich default under FORCE_COLOR contains the added-row background escape', () => {
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      makeTurn('x');
      makeTurn('y');
      const output = compute(['1', '2']);
      assert.match(output, /\x1b\[48;5;22m/);
    });
  });

  test('--json emits structured diff with counts for two turns', () => {
    makeTurn('x');
    makeTurn('y');

    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const parsed = JSON.parse(compute(['1', '2', '--json']));
      assert.equal(parsed.from_turn, 1);
      assert.equal(parsed.to_turn, 2);
      assert.ok(parsed.sha_a);
      assert.ok(parsed.sha_b);
      assert.match(parsed.diff, /diff --git/);
      assert.doesNotMatch(parsed.diff, /\x1b/);
      assert.equal(parsed.added, 1);
      assert.equal(parsed.removed, 0);
    });
  });

  test('--json for first turn has from_turn null and sha_a === EMPTY_TREE', () => {
    makeTurn('a');
    const parsed = JSON.parse(compute(['1', '--json']));
    assert.equal(parsed.from_turn, null);
    assert.equal(parsed.sha_a, EMPTY_TREE);
  });

  test('--json wins over --plain when both flags present', () => {
    makeTurn('x');
    makeTurn('y');
    assert.equal(compute(['1', '2', '--json', '--plain']), compute(['1', '2', '--json']));
  });

  test('flag position does not affect result', () => {
    makeTurn('x');
    makeTurn('y');
    assert.equal(compute(['--plain', '1', '2']), compute(['1', '2', '--plain']));
  });

  test('compute throws Usage error for non-numeric first arg', () => {
    makeTurn('a');
    assert.throws(() => compute(['abc']), { message: 'Usage: git turn diff <N> [M]' });
  });

  test('compute throws Usage error for non-numeric second arg', () => {
    makeTurn('a');
    assert.throws(() => compute(['1', 'abc']), { message: 'Usage: git turn diff <N> [M]' });
  });

  test('compute throws not-found error for missing turn', () => {
    makeTurn('a');
    assert.throws(() => compute(['9']), { message: 'git turn: turn 9 not found' });
  });

  test('compute throws not-initialized error when no session exists', () => {
    const sessionPath = join(dir, '.git', 'git-turn', 'session.json');
    rmSync(sessionPath, { force: true });
    assert.throws(() => compute(['1']), { message: 'git turn: not initialized. Run `git turn init` first.' });
  });

  test('run with --json on not-found prints only the JSON error and exits 1', () => {
    makeTurn('a');

    const origExit = process.exit;
    const logs = [];
    const errs = [];
    const origLog = console.log;
    const origErr = console.error;
    let exitCode = null;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => errs.push(args.join(' '));
    process.exit = (code) => { exitCode = code; throw new Error('process.exit(' + code + ')'); };
    try {
      run(['9', '--json']);
    } catch (e) {
      if (!e.message.startsWith('process.exit')) throw e;
    } finally {
      process.exit = origExit;
      console.log = origLog;
      console.error = origErr;
    }
    assert.equal(exitCode, 1);
    assert.deepEqual(logs, ['{"error":"git turn: turn 9 not found"}']);
    assert.deepEqual(errs, []);
  });

  test('Test A: opts.color false suppresses ANSI on rich branch under FORCE_COLOR', () => {
    makeTurn('x');
    makeTurn('y');
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const output = compute(['1', '2'], { color: false });
      assert.doesNotMatch(output, /\x1b\[/);
    });
  });

  test('Test B: opts.color false suppresses ANSI on --plain branch under FORCE_COLOR', () => {
    makeTurn('x');
    makeTurn('y');
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const output = compute(['1', '2', '--plain'], { color: false });
      assert.doesNotMatch(output, /\x1b\[/);
    });
  });

  test('Test C: opts.color false suppresses ANSI for single-turn form under FORCE_COLOR', () => {
    makeTurn('a');
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const output = compute(['1'], { color: false });
      assert.doesNotMatch(output, /\x1b\[/);
    });
  });

  test('Test D (regression guard T-09-01): no opts.color under FORCE_COLOR still colors', () => {
    makeTurn('x');
    makeTurn('y');
    withEnv({ FORCE_COLOR: '1', NO_COLOR: undefined }, () => {
      const output = compute(['1', '2']);
      assert.match(output, /\x1b\[/);
    });
  });

  test('Test E: opts.color true forces ANSI even under NO_COLOR', () => {
    makeTurn('x');
    makeTurn('y');
    withEnv({ NO_COLOR: '1', FORCE_COLOR: undefined }, () => {
      const output = compute(['1', '2'], { color: true });
      assert.match(output, /\x1b\[/);
    });
  });

  test('Test F: opts.color false under NO_COLOR equals default output under NO_COLOR byte-for-byte', () => {
    makeTurn('x');
    makeTurn('y');
    withEnv({ NO_COLOR: '1', FORCE_COLOR: undefined }, () => {
      const withOverride = compute(['1', '2'], { color: false });
      const withoutOverride = compute(['1', '2']);
      assert.equal(withOverride, withoutOverride);
    });
  });
});
