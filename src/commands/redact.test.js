'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');

describe('redact command', () => {
  let dir, origCwd, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    const { startSession } = require('../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  // Monkeypatches fs.readFileSync so fd 0 returns the given payload (an
  // object is JSON.stringify'd, a raw string is passed through verbatim).
  // Also captures console.log/console.error and stubs process.exit to throw
  // a recognizable error so exit codes are assertable without actually
  // killing the test process.
  function runWithStdin(payloadOrRawString) {
    const fsMod = require('fs');
    const origRead = fsMod.readFileSync;
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;
    const origStderrWrite = process.stderr.write;

    const out = [];
    const err = [];
    let exitCode = null;

    fsMod.readFileSync = (fd, enc) => {
      if (fd === 0) {
        return typeof payloadOrRawString === 'string'
          ? payloadOrRawString
          : JSON.stringify(payloadOrRawString);
      }
      return origRead(fd, enc);
    };
    console.log = (...args) => out.push(args.join(' '));
    console.error = (...args) => err.push(args.join(' '));
    process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
    process.exit = (code) => { throw new Error('EXIT:' + code); };

    try {
      delete require.cache[require.resolve('./record-prompt')];
      require('./record-prompt').run([]);
    } catch (e) {
      const m = /^EXIT:(\d+)$/.exec(e.message);
      if (m) {
        exitCode = parseInt(m[1], 10);
      } else {
        throw e;
      }
    } finally {
      fsMod.readFileSync = origRead;
      console.log = origLog;
      console.error = origErr;
      process.stderr.write = origStderrWrite;
      process.exit = origExit;
    }

    return { out, err: err.join('\n'), exitCode };
  }

  function readNote() {
    const { listTurns, NOTES_REF } = require('../session');
    const { getNote } = require('../git');
    const { parseSnapshotMessage } = require('../blame-util');
    const turns = listTurns(session.session_id);
    const latest = turns[turns.length - 1];
    const { headSha } = parseSnapshotMessage(latest.sha);
    return JSON.parse(getNote(NOTES_REF, headSha));
  }

  // Seeds the exact hook-shipped note payload on a freshly-made turn, so
  // tests reproduce the pre-existing state a real post-commit hook would
  // have left behind before redact ever runs.
  function seedHookNote() {
    const { makeTurn } = require('../helpers/turn-fixtures');
    const { addNote } = require('../git');
    const { NOTES_REF } = require('../session');
    const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id,
      turn_n: 1,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
    }));
    return { headSha, snapshotSha };
  }

  // Captures console.log/console.error/process.stderr.write and stubs
  // process.exit to throw a recognizable error, then invokes redact.run(args).
  function captureRedact(args) {
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;
    const origStderrWrite = process.stderr.write;

    const out = [];
    const err = [];
    let exitCode = null;

    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => err.push(a.join(' '));
    process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
    process.exit = (code) => { throw new Error('EXIT:' + code); };

    try {
      delete require.cache[require.resolve('./redact')];
      require('./redact').run(args);
    } catch (e) {
      const m = /^EXIT:(\d+)$/.exec(e.message);
      if (m) {
        exitCode = parseInt(m[1], 10);
      } else {
        throw e;
      }
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.stderr.write = origStderrWrite;
      process.exit = origExit;
    }

    return { out, err: err.join('\n'), exitCode };
  }

  test('REDACT-02: clears prompt but preserves every other field', () => {
    seedHookNote();
    runWithStdin({
      prompt: 'secret-ish prompt text',
      model: 'claude-sonnet-4-5',
      latency_ms: 4200,
      usage: { input_tokens: 10, output_tokens: 5 },
      tool_summary: { Read: 2 },
    });
    const before = readNote();
    captureRedact(['1']);
    const after = readNote();

    assert.equal(after.prompt, '[REDACTED]');
    assert.ok(!after.prompt.includes('secret-ish'));
    assert.equal(after.model, before.model);
    assert.equal(after.latency_ms, before.latency_ms);
    assert.equal(after.session_id, before.session_id);
    assert.equal(after.turn_n, before.turn_n);
    assert.equal(after.snapshot_sha, before.snapshot_sha);
    assert.equal(after.ts, before.ts);
    assert.deepEqual(after.usage, before.usage);
    assert.deepEqual(after.tool_summary, before.tool_summary);
  });

  test('REDACT-02: no-ops when there is no prompt to redact', () => {
    seedHookNote();
    const before = readNote();
    const { out } = captureRedact(['1']);
    assert.match(out.join('\n'), /nothing to redact/);
    assert.deepEqual(readNote(), before);
  });

  test('REDACT-02: exits 1 for a nonexistent turn number', () => {
    seedHookNote();
    const { exitCode, err } = captureRedact(['99']);
    assert.equal(exitCode, 1);
    assert.match(err, /turn 99 not found/);
  });

  test('REDACT-02: exits 1 with usage message for a non-numeric argument', () => {
    seedHookNote();
    const { exitCode, err } = captureRedact(['abc']);
    assert.equal(exitCode, 1);
    assert.match(err, /Usage: git turn redact <N>/);
  });

  test('REDACT-02: cache row reflects [REDACTED] prompt after redact', () => {
    seedHookNote();
    runWithStdin({ prompt: 'secret-ish prompt text' });
    captureRedact(['1']);
    const rows = require('../cache').getTurns(session.session_id);
    assert.equal(rows[0].prompt, '[REDACTED]');
  });
});
