'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../../helpers/test-repo');
const { handler } = require('./blame');

describe('git_turn_blame tool', () => {
  let dir, origCwd, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);

    const { startSession } = require('../../helpers/turn-fixtures');
    session = startSession();
  });

  afterEach(() => {
    try { require('../../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('handler({ file }) matches compute([file]) after three turns rewriting the file', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    makeTurn(session, 'b', repo.git);
    makeTurn(session, 'c', repo.git);

    const result = await handler({ file: 'work.txt' });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, require('../../commands/blame').compute(['work.txt']));
    assert.match(result.content[0].text, new RegExp(session.session_id.slice(0, 8) + ':3'));
  });

  test('handler({ file, noCache: true }) matches compute([file, "--no-cache"])', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    makeTurn(session, 'b', repo.git);
    makeTurn(session, 'c', repo.git);

    const result = await handler({ file: 'work.txt', noCache: true });
    assert.equal(result.content[0].text, require('../../commands/blame').compute(['work.txt', '--no-cache']));
  });

  test('MCP-09: unknown file returns isError true with exact message', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);

    const result = await handler({ file: 'nope.txt' });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'git turn: no history for nope.txt');
  });

  test('MCP-09: uninitialized repo returns isError true with exact message', async () => {
    const uninit = makeTestRepo();
    const prevCwd = process.cwd();
    process.chdir(uninit.dir);
    try {
      const result = await handler({ file: 'work.txt' });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, 'git turn: not initialized. Run `git turn init` first.');
    } finally {
      process.chdir(prevCwd);
      rmSync(uninit.dir, { recursive: true, force: true });
    }
  });

  test('handler never writes to process.stderr', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    makeTurn(session, 'b', repo.git);

    const origWrite = process.stderr.write;
    let calls = 0;
    process.stderr.write = (...args) => { calls++; return origWrite.apply(process.stderr, args); };
    try {
      await handler({ file: 'work.txt' });
    } finally {
      process.stderr.write = origWrite;
    }
    assert.equal(calls, 0);
  });
});
