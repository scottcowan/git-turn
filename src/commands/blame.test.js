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
});
