'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');

describe('record-prompt command', () => {
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
  // have left behind before record-prompt ever runs.
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

  test('CAPTURE-01: merges prompt/model into the note without clobbering hook fields', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5' });
    const note = readNote();
    assert.equal(note.session_id, session.session_id);
    assert.equal(note.turn_n, 1);
    assert.ok(note.snapshot_sha);
    assert.equal(note.ts, '2026-09-18T00:00:00.000Z');
    assert.equal(note.prompt, 'why did this break');
    assert.equal(note.model, 'claude-sonnet-4-5');
  });

  test('CAPTURE-01: a second call merges instead of replacing (D-03)', () => {
    seedHookNote();
    runWithStdin({ prompt: 'p' });
    runWithStdin({ model: 'm' });
    const note = readNote();
    assert.equal(note.prompt, 'p');
    assert.equal(note.model, 'm');
    assert.equal(note.session_id, session.session_id);
    assert.equal(note.turn_n, 1);
  });

  test('CAPTURE-01: targets the turn index, not bare HEAD', () => {
    const { headSha: turn1Head } = seedHookNote();
    repo.git(['commit', '-q', '--allow-empty', '-m', 'not a turn']);

    runWithStdin({ prompt: 'hi' });

    const note = readNote();
    assert.equal(note.prompt, 'hi');

    const { getNote } = require('../git');
    const { NOTES_REF } = require('../session');
    const { headSha } = require('../git');
    assert.ok(!getNote(NOTES_REF, headSha()), 'current HEAD must not have a note attached');
    assert.notEqual(headSha(), turn1Head);
  });

  test('CAPTURE-02: usage is stored verbatim in the four-key Anthropic shape', () => {
    seedHookNote();
    const usage = {
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 15,
    };
    runWithStdin({ usage });
    const note = readNote();
    assert.deepEqual(note.usage, usage);
  });

  test('CAPTURE-03: latency_ms passes through to note and cache', () => {
    seedHookNote();
    runWithStdin({ latency_ms: 4200 });
    const note = readNote();
    assert.equal(note.latency_ms, 4200);

    const { getTurns } = require('../cache');
    const rows = getTurns(session.session_id);
    assert.equal(rows[0].latency_ms, 4200);
  });

  test('CAPTURE-04: tool_summary per-tool breakdown round-trips (D-04)', () => {
    seedHookNote();
    const tool_summary = { Read: 5, Edit: 2, Bash: 1 };
    runWithStdin({ tool_summary });
    const note = readNote();
    assert.deepEqual(note.tool_summary, tool_summary);

    const { getTurns } = require('../cache');
    const rows = getTurns(session.session_id);
    assert.deepEqual(JSON.parse(rows[0].tool_summary), tool_summary);
  });

  test('redacts secrets in prompt before the note is written', () => {
    seedHookNote();
    const { err } = runWithStdin({ prompt: 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE' });
    const note = readNote();
    assert.ok(!note.prompt.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(note.prompt.includes('[REDACTED]'));
    assert.match(err, /redacted 1 potential secret/);
  });

  test('reports the recorded fields on stdout', () => {
    seedHookNote();
    const { out } = runWithStdin({ prompt: 'hi', model: 'claude-sonnet-4-5' });
    const combined = out.join('\n');
    assert.match(combined, /Turn 1/);
    assert.match(combined, /prompt/);
    assert.match(combined, /model/);
  });

  test('fails loudly on malformed JSON stdin', () => {
    seedHookNote();
    const { exitCode, err } = runWithStdin('{not json');
    assert.equal(exitCode, 1);
    assert.match(err, /git turn: invalid JSON on stdin/);
  });

  test('fails loudly on empty stdin', () => {
    seedHookNote();
    const { exitCode, err } = runWithStdin('');
    assert.equal(exitCode, 1);
    assert.match(err, /requires a JSON payload on stdin/);
  });

  test('rejects a non-string prompt', () => {
    seedHookNote();
    const before = readNote();
    const { exitCode, err } = runWithStdin({ prompt: 42 });
    assert.equal(exitCode, 1);
    assert.match(err, /prompt must be a string/);
    assert.deepEqual(readNote(), before);
  });

  test('rejects a non-object usage', () => {
    seedHookNote();
    const { exitCode, err } = runWithStdin({ usage: 'lots' });
    assert.equal(exitCode, 1);
    assert.match(err, /usage must be a JSON object/);
  });

  test('fails when the session has no turns yet', () => {
    const { exitCode, err } = runWithStdin({ prompt: 'hi' });
    assert.equal(exitCode, 1);
    assert.match(err, /no turns yet this session/);
  });
});
