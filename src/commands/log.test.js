'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../helpers/test-repo');

describe('log command', () => {
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

  // Captures console.log/console.error for log.js's run(args), stubbing
  // process.exit to throw a recognizable error so exit codes are
  // assertable without actually killing the test process.
  function captureLog(args) {
    const origLog = console.log;
    const origErr = console.error;
    const origExit = process.exit;

    const out = [];
    const err = [];
    let exitCode = null;

    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => err.push(a.join(' '));
    process.exit = (code) => { throw new Error('EXIT:' + code); };

    try {
      delete require.cache[require.resolve('./log')];
      require('./log').run(args);
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
      process.exit = origExit;
    }

    return { out, err, exitCode };
  }

  test('VERIFY-01: log --with-prompts --no-cache renders real captured prompt end-to-end', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5' });
    const { out } = captureLog(['--with-prompts', '--no-cache']);
    assert.match(out.join('\n'), /prompt: why did this break/);
  });

  test('VERIFY-01: log --with-prompts (cache path) renders real captured prompt end-to-end', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5' });
    const { out } = captureLog(['--with-prompts']);
    assert.match(out.join('\n'), /prompt: why did this break/);
  });

  test('log --no-cache without --with-prompts prints the turn row but no prompt line', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5' });
    const { out } = captureLog(['--no-cache']);
    const combined = out.join('\n');
    assert.match(combined, /turn\s+1/);
    assert.ok(!combined.includes('why did this break'));
  });

  test('compute(["--no-cache"]) after one recorded turn returns the Session header and turn row', () => {
    const { makeTurn } = require('../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');
    const result = compute(['--no-cache']);
    assert.match(result, /turn\s+1/);
    assert.ok(result.startsWith(`Session: ${session.session_id}\n\n`));
  });

  test('compute([]) with no session.json throws the not-initialized error', () => {
    const { rmSync: rm } = require('fs');
    const { join } = require('path');
    rm(join(dir, '.git', 'git-turn', 'session.json'), { force: true });
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');
    assert.throws(() => compute([]), { message: 'git turn: not initialized. Run `git turn init` first.' });
  });

  test('compute(["--json","--no-cache"]) returns a single-turn array with the documented keys and no prompt', () => {
    const { makeTurn } = require('../helpers/turn-fixtures');
    const { headSha: turnHead } = makeTurn(session, 'a', repo.git);
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');
    const arr = JSON.parse(compute(['--json', '--no-cache']));
    assert.equal(arr.length, 1);
    assert.equal(arr[0].turn, 1);
    assert.equal(arr[0].sha, turnHead);
    assert.match(arr[0].sha, /^[0-9a-f]{40}$/);
    assert.ok('snapshot_sha' in arr[0]);
    assert.ok('subject' in arr[0]);
    assert.ok('files_changed' in arr[0]);
    assert.ok('insertions' in arr[0]);
    assert.ok('deletions' in arr[0]);
    assert.ok(!('prompt' in arr[0]));
  });

  test('compute(["--json","--with-prompts","--no-cache"]) includes the full recorded prompt', () => {
    seedHookNote();
    runWithStdin({ prompt: 'why did this break', model: 'claude-sonnet-4-5' });
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');
    const arr = JSON.parse(compute(['--json', '--with-prompts', '--no-cache']));
    assert.equal(arr[0].prompt, 'why did this break');
  });

  test('compute(["--json"]) cache path matches the --no-cache path for the same turn', () => {
    const { makeTurn } = require('../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');
    const noCacheArr = JSON.parse(compute(['--json', '--no-cache']));
    const cacheArr = JSON.parse(compute(['--json']));
    assert.equal(cacheArr[0].turn, noCacheArr[0].turn);
    assert.equal(cacheArr[0].sha, noCacheArr[0].sha);
    assert.equal(cacheArr[0].snapshot_sha, noCacheArr[0].snapshot_sha);
    assert.equal(cacheArr[0].subject, noCacheArr[0].subject);
  });

  test('compute(["--json","--no-cache"]) on a session with zero turns returns []', () => {
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');
    assert.equal(compute(['--json', '--no-cache']), '[]');
  });

  test('run(["--json"]) with no session prints the json error and exits 1', () => {
    const { rmSync: rm } = require('fs');
    const { join } = require('path');
    rm(join(dir, '.git', 'git-turn', 'session.json'), { force: true });
    delete require.cache[require.resolve('./log')];
    const { out, err, exitCode } = captureLog(['--json']);
    assert.equal(exitCode, 1);
    assert.equal(out.join('\n'), '{"error":"git turn: not initialized. Run `git turn init` first."}');
    assert.equal(err.length, 0);
  });

  test('compute() with no opts never writes to console.log/console.error/process.stderr.write', () => {
    const { makeTurn } = require('../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    delete require.cache[require.resolve('./log')];
    const { compute } = require('./log');

    const origLog = console.log;
    const origErr = console.error;
    const origStderrWrite = process.stderr.write;
    console.log = () => { throw new Error('unexpected console.log'); };
    console.error = () => { throw new Error('unexpected console.error'); };
    process.stderr.write = () => { throw new Error('unexpected process.stderr.write'); };

    try {
      assert.doesNotThrow(() => compute(['--no-cache']));
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.stderr.write = origStderrWrite;
    }
  });
});
