'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync, appendFileSync } = require('fs');
const { execFileSync } = require('child_process');
const { join } = require('path');
const { makeTestRepo } = require('../helpers/test-repo');
const { ensureDirs } = require('../session');
const { startSession, makeTurn, makeUntrackedTurn } = require('../helpers/turn-fixtures');
const { closeDb } = require('../cache');

describe('blame command', () => {
  let repoDir;
  let origCwd;
  let git;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    repoDir = repo.dir;
    git = repo.git;
    process.chdir(repoDir);
    ensureDirs();
  });

  afterEach(() => {
    process.chdir(origCwd);
    closeDb();
    rmSync(repoDir, { recursive: true, force: true });
  });

  /**
   * Capture console.log output from run(args), for the success paths.
   */
  function captureBlame(args) {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
      require('./blame').run(args);
    } finally {
      console.log = origLog;
    }
    return logs.join('\n');
  }

  /**
   * Parse a formatted blame line back into { attr, lineNo, content },
   * matching blame.js's formatLine layout exactly:
   * attr.padEnd(24) + ' ' + lineNo.padStart(4) + ') ' + content
   */
  function parseFormattedLine(line) {
    return {
      attr: line.slice(0, 24).trimEnd(),
      lineNo: parseInt(line.slice(25, 29), 10),
      content: line.slice(31),
    };
  }

  /**
   * Capture console.error output and stub process.exit to throw a sentinel
   * error, so exit paths (usage, not-initialized, no-history) are
   * assertable without actually terminating the test process.
   */
  function captureBlameExit(args) {
    const errors = [];
    const origError = console.error;
    const origExit = process.exit;
    console.error = (...a) => errors.push(a.join(' '));
    process.exit = () => { throw new Error('__EXIT__'); };
    try {
      require('./blame').run(args);
      return { errors, exited: false };
    } catch (e) {
      if (e.message !== '__EXIT__') throw e;
      return { errors, exited: true };
    } finally {
      console.error = origError;
      process.exit = origExit;
    }
  }

  test('D-01: three turns rewriting work.txt attribute the one line to turn 3', () => {
    const session = startSession();
    makeTurn(session, 'v1', git);
    makeTurn(session, 'v2', git);
    makeTurn(session, 'v3', git);

    const output = captureBlame(['work.txt']);
    const lines = output.split('\n').slice(2); // drop header + blank line
    const parsed = lines.map(parseFormattedLine);
    const contentLine = parsed.find(p => p.content === 'v3');
    assert.ok(contentLine, 'expected a line with content v3');
    assert.equal(contentLine.lineNo, 1);
    assert.match(contentLine.attr, /^[0-9a-f]{8}:3$/);
  });

  test('D-01: per-line attribution — line 1 to turn 1, line 2 to turn 2', () => {
    const session = startSession();
    makeTurn(session, 'A', git);
    makeTurn(session, 'A\nB', git);

    const output = captureBlame(['work.txt']);
    const lines = output.split('\n').slice(2);
    const parsed = lines.map(parseFormattedLine);
    const line1 = parsed.find(p => p.lineNo === 1);
    const line2 = parsed.find(p => p.lineNo === 2);
    assert.ok(line1, 'expected line 1');
    assert.ok(line2, 'expected line 2');
    assert.equal(line1.content, 'A');
    assert.equal(line2.content, 'B');
    assert.match(line1.attr, /^[0-9a-f]{8}:1$/);
    assert.match(line2.attr, /^[0-9a-f]{8}:2$/);
  });

  test('README.md (pre-session commit) is attributed as not a turn', () => {
    startSession();
    const output = captureBlame(['README.md']);
    assert.match(output, /\(not a turn\)/);
  });

  test('uncommitted appended line renders as (uncommitted)', () => {
    const session = startSession();
    makeTurn(session, 'v1', git);
    appendFileSync(join(process.cwd(), 'work.txt'), 'dirty\n');

    const output = captureBlame(['work.txt']);
    assert.match(output, /\(uncommitted\)/);
  });

  test('running with no argument prints usage and exits nonzero', () => {
    startSession();
    const { errors, exited } = captureBlameExit([]);
    assert.ok(exited, 'expected process.exit to be called');
    assert.ok(errors.some(e => e.includes('Usage: git turn blame')));
  });

  test('path with no git history and no snapshot history prints no-history error', () => {
    startSession();
    const { errors, exited } = captureBlameExit(['nonexistent.txt']);
    assert.ok(exited, 'expected process.exit to be called');
    assert.ok(errors.some(e => e.includes('no history for nonexistent.txt')));
  });

  test('not initialized when no session exists', () => {
    const { errors, exited } = captureBlameExit(['README.md']);
    assert.ok(exited, 'expected process.exit to be called');
    assert.ok(errors.some(e => e.includes('not initialized')));
  });

  test('output line count equals file line count plus header lines', () => {
    const session = startSession();
    makeTurn(session, 'a\nb\nc', git);

    const output = captureBlame(['work.txt']);
    const lines = output.split('\n');
    // Header: "Blame: <file>", blank line, then 3 content lines = 5 total.
    assert.equal(lines.length, 5);
  });

  describe('cross-session attribution (D-02)', () => {
    test('lines from two different sessions both show their own session prefix', () => {
      const sessionA = startSession();
      makeTurn(sessionA, 'A1', git);
      makeTurn(sessionA, 'A1\nA2', git);

      const sessionB = startSession();
      makeTurn(sessionB, 'A1\nA2\nB1', git);
      makeTurn(sessionB, 'A1\nA2\nB1\nB2', git);

      const output = captureBlame(['work.txt']);
      const prefixA = sessionA.session_id.slice(0, 8);
      const prefixB = sessionB.session_id.slice(0, 8);
      assert.ok(output.includes(prefixA), 'expected session A prefix in output');
      assert.ok(output.includes(prefixB), 'expected session B prefix in output');

      const lines = output.split('\n').slice(2);
      const parsed = lines.map(parseFormattedLine);
      const line1 = parsed.find(p => p.lineNo === 1);
      assert.ok(line1, 'expected line 1 with content A1');
      assert.equal(line1.content, 'A1');
      assert.match(line1.attr, new RegExp(`^${prefixA}:1$`), 'earliest line must still carry session A prefix');
    });
  });

  describe('untracked-snapshot fallback', () => {
    test('untracked-only file is blamed via the annotator with the marker line', () => {
      const session = startSession();
      makeUntrackedTurn(session, 'x1', git, { file: 'notes.txt' });
      // orderByCommitTopology's rev-list ordering is only deterministic
      // across commits with distinct (second-resolution) commit timestamps
      // (see 03-01-SUMMARY.md) — space these fixture commits >1s apart.
      execFileSync('sleep', ['1.1']);
      makeUntrackedTurn(session, 'x1\nx2', git, { file: 'notes.txt' });

      const output = captureBlame(['notes.txt']);
      assert.match(output, /\(untracked — annotated from turn snapshots\)/);

      const lines = output.split('\n').slice(3); // header + marker + blank line
      const parsed = lines.map(parseFormattedLine);
      const line1 = parsed.find(p => p.lineNo === 1);
      const line2 = parsed.find(p => p.lineNo === 2);
      assert.ok(line1, 'expected line 1 with content x1');
      assert.ok(line2, 'expected line 2 with content x2');
      assert.equal(line1.content, 'x1');
      assert.equal(line2.content, 'x2');
    });
  });

  describe('--no-cache parity', () => {
    test('cached and no-cache runs produce byte-identical output', () => {
      const session = startSession();
      makeTurn(session, 'v1', git);
      makeTurn(session, 'v1\nv2', git);

      const cached = captureBlame(['work.txt']);
      closeDb();
      const noCache = captureBlame(['work.txt', '--no-cache']);
      assert.equal(cached, noCache);
    });
  });

  describe('compute()/run() split + --json', () => {
    test('compute(["work.txt"]) for a tracked file matches the run() text layout', () => {
      const session = startSession();
      makeTurn(session, 'v1', git);

      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      const result = compute(['work.txt']);
      const lines = result.split('\n');
      assert.equal(lines[0], 'Blame: work.txt');
      assert.equal(lines[1], '');
      const parsed = parseFormattedLine(lines[2]);
      assert.equal(parsed.content, 'v1');
      assert.match(parsed.attr, /^[0-9a-f]{8}:1$/);
    });

    test('compute(["untracked.txt"]) for an untracked-only file includes the marker line', () => {
      const session = startSession();
      makeUntrackedTurn(session, 'x1', git, { file: 'untracked.txt' });

      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      const result = compute(['untracked.txt']);
      const lines = result.split('\n');
      assert.equal(lines[1], '(untracked — annotated from turn snapshots)');
    });

    test('compute() throws the documented messages for usage/no-history/not-initialized', () => {
      startSession();
      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      assert.throws(() => compute([]), { message: 'Usage: git turn blame <file> [--no-cache]' });
      assert.throws(() => compute(['nonexistent.txt']), { message: 'git turn: no history for nonexistent.txt' });
    });

    test('compute() throws not-initialized when no session exists', () => {
      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      assert.throws(() => compute(['README.md']), { message: 'git turn: not initialized. Run `git turn init` first.' });
    });

    test('compute(["work.txt","--json"]) returns the documented tracked shape', () => {
      const session = startSession();
      makeTurn(session, 'v1', git);

      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      const parsed = JSON.parse(compute(['work.txt', '--json']));
      assert.equal(parsed.file, 'work.txt');
      assert.equal(parsed.tracked, true);
      assert.deepEqual(parsed.warnings, []);
      assert.equal(parsed.lines.length, 1);
      assert.equal(parsed.lines[0].line, 1);
      assert.match(parsed.lines[0].attribution, /^[0-9a-f]{8}:\d+$/);
      assert.equal(parsed.lines[0].session_id, session.session_id);
      assert.equal(parsed.lines[0].turn, 1);
      assert.equal(parsed.lines[0].content, 'v1');
    });

    test('compute(["untracked.txt","--json"]) returns the same key set with tracked:false', () => {
      const session = startSession();
      makeUntrackedTurn(session, 'x1', git, { file: 'untracked.txt' });

      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      const parsed = JSON.parse(compute(['untracked.txt', '--json']));
      assert.equal(parsed.file, 'untracked.txt');
      assert.equal(parsed.tracked, false);
      assert.deepEqual(parsed.warnings, []);
      assert.equal(parsed.lines.length, 1);
      assert.equal(parsed.lines[0].content, 'x1');
    });

    test('pre-session commit lines and uncommitted lines have null session_id/turn in --json', () => {
      startSession();
      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      const notATurn = JSON.parse(compute(['README.md', '--json']));
      assert.match(notATurn.lines[0].attribution, /\(not a turn\)$/);
      assert.equal(notATurn.lines[0].session_id, null);
      assert.equal(notATurn.lines[0].turn, null);

      const session = startSession();
      makeTurn(session, 'v1', git);
      appendFileSync(join(process.cwd(), 'work.txt'), 'dirty\n');
      delete require.cache[require.resolve('./blame')];
      const { compute: compute2 } = require('./blame');
      const uncommitted = JSON.parse(compute2(['work.txt', '--json']));
      const dirtyLine = uncommitted.lines.find(l => l.content === 'dirty');
      assert.ok(dirtyLine, 'expected a dirty line');
      assert.equal(dirtyLine.attribution, '(uncommitted)');
      assert.equal(dirtyLine.session_id, null);
      assert.equal(dirtyLine.turn, null);
    });

    test('"--json" is not mistaken for the file argument', () => {
      const session = startSession();
      makeTurn(session, 'v1', git);

      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');
      const result = compute(['--json', 'work.txt']);
      const parsed = JSON.parse(result);
      assert.equal(parsed.file, 'work.txt');
    });

    test('duplicate head_sha collision: stderr sink called once, --json warnings populated, no-opts call writes nothing', () => {
      const { updateRef, headSha: resolveHeadSha, currentBranch } = require('../git');
      const { turnRef } = require('../session');

      const session = startSession();
      makeTurn(session, 'v1', git);
      const head = resolveHeadSha();

      // Craft a second turn ref whose snapshot message carries the SAME
      // `head` line as the first, so buildHeadShaIndex sees a collision.
      const dupMessage = [
        'turn dup',
        `session ${session.session_id}`,
        `turn_n ${session.turn_n + 1}`,
        'trigger fixture',
        `head ${head}`,
        `branch ${currentBranch()}`,
        `created ${new Date().toISOString()}`,
      ].join('\n');
      const { commitSha } = require('../git').snapshotWorktree({ message: dupMessage });
      session.turn_n += 1;
      updateRef(turnRef(session.session_id, session.turn_n), commitSha);

      delete require.cache[require.resolve('./blame')];
      const { compute } = require('./blame');

      const sinkCalls = [];
      const resultWithSink = compute(['work.txt', '--no-cache'], { stderr: (s) => sinkCalls.push(s) });
      assert.equal(sinkCalls.length, 1);
      assert.equal(sinkCalls[0], 'git turn: warning: 1 duplicate head_sha value(s) in turn history; attribution may be ambiguous\n');
      assert.ok(resultWithSink);

      const origStderrWrite = process.stderr.write;
      process.stderr.write = () => { throw new Error('unexpected process.stderr.write'); };
      try {
        assert.doesNotThrow(() => compute(['work.txt', '--no-cache']));
      } finally {
        process.stderr.write = origStderrWrite;
      }

      const jsonResult = JSON.parse(compute(['work.txt', '--json', '--no-cache']));
      assert.deepEqual(jsonResult.warnings, ['1 duplicate head_sha value(s) in turn history; attribution may be ambiguous']);
    });
  });
});
