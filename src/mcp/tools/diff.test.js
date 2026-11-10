'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../../helpers/test-repo');
const { handler } = require('./diff');

describe('git_turn_diff tool', () => {
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

  function seedThreeTurns() {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    makeTurn(session, 'b', repo.git);
    makeTurn(session, 'c', repo.git);
  }

  test('handler({ turn: 2 }) matches compute(["2"], { color: false })', async () => {
    seedThreeTurns();
    const result = await handler({ turn: 2 });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, require('../../commands/diff').compute(['2'], { color: false }));
  });

  test('two-turn form: handler({ turn: 1, toTurn: 3 }) matches compute(["1", "3"], { color: false })', async () => {
    seedThreeTurns();
    const result = await handler({ turn: 1, toTurn: 3 });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, require('../../commands/diff').compute(['1', '3'], { color: false }));
    assert.match(result.content[0].text, /\+ c$/m);
  });

  test('turn 1 alone diffs against the empty tree', async () => {
    seedThreeTurns();
    const result = await handler({ turn: 1 });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /\+ a$/m);
  });

  test('VERIFY-03: real makeTurn fixtures produce summary and +/- rows', async () => {
    seedThreeTurns();
    const result = await handler({ turn: 2 });
    assert.match(result.content[0].text, /^Added \d+ \/ removed \d+/m);
    assert.match(result.content[0].text, /- a$/m);
    assert.match(result.content[0].text, /\+ b$/m);
  });

  test('D-02/MCP-10: FORCE_COLOR set, NO_COLOR unset — no ANSI escapes in either form', async () => {
    seedThreeTurns();
    const origForceColor = process.env.FORCE_COLOR;
    const origNoColor = process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    try {
      const single = await handler({ turn: 2 });
      assert.ok(!single.content[0].text.includes('\x1b['));
      const twoTurn = await handler({ turn: 1, toTurn: 3 });
      assert.ok(!twoTurn.content[0].text.includes('\x1b['));
    } finally {
      if (origForceColor === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForceColor;
      if (origNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNoColor;
    }
  });

  test('MCP-09: out-of-range turn N returns isError true, exact message', async () => {
    seedThreeTurns();
    const result = await handler({ turn: 999 });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'git turn: turn 999 not found');
  });

  test('MCP-09: out-of-range toTurn M returns isError true, exact message', async () => {
    seedThreeTurns();
    const result = await handler({ turn: 1, toTurn: 999 });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'git turn: turn 999 not found');
  });

  test('MCP-09: uninitialized repo returns isError true with exact message, never throws', async () => {
    const uninit = makeTestRepo();
    const prevCwd = process.cwd();
    process.chdir(uninit.dir);
    try {
      const result = await handler({ turn: 1 });
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, 'git turn: not initialized. Run `git turn init` first.');
    } finally {
      process.chdir(prevCwd);
      rmSync(uninit.dir, { recursive: true, force: true });
    }
  });
});

describe('git_turn_diff direct-call guards', () => {
  test('missing turn / bad toTurn return isError', async () => {
    const expected = { content: [{ type: 'text', text: 'git turn: turn is required' }], isError: true };
    assert.deepEqual(await handler({}), expected);
    assert.deepEqual(await handler({ turn: undefined }), expected);
    assert.deepEqual(await handler(), expected);
    assert.deepEqual(await handler({ turn: 1, toTurn: 'x' }),
      { content: [{ type: 'text', text: 'git turn: toTurn must be a number' }], isError: true });
  });
});
