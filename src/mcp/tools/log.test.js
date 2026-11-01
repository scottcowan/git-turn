'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../../helpers/test-repo');
const { addNote } = require('../../git');
const { NOTES_REF } = require('../../session');
const { handler } = require('./log');

describe('git_turn_log tool', () => {
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

  test('handler({}) matches compute([]) after two turns', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    makeTurn(session, 'b', repo.git);

    const result = await handler({});
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, require('../../commands/log').compute([]));
  });

  test('handler({ noCache: true }) matches compute(["--no-cache"])', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    makeTurn(session, 'a', repo.git);
    makeTurn(session, 'b', repo.git);

    const result = await handler({ noCache: true });
    assert.equal(result.content[0].text, require('../../commands/log').compute(['--no-cache']));
  });

  test('VERIFY-03: withPrompts true includes prompt text; withPrompts false excludes it', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id,
      turn_n: 1,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
      prompt: 'roundtrip prompt text',
    }));

    const withPrompts = await handler({ withPrompts: true, noCache: true });
    assert.ok(withPrompts.content[0].text.includes('prompt: roundtrip prompt text'));

    const withoutPrompts = await handler({ withPrompts: false, noCache: true });
    assert.ok(!withoutPrompts.content[0].text.includes('roundtrip prompt text'));
  });

  test('MCP-09: uninitialized repo returns isError true with exact message, never throws', async () => {
    const uninit = makeTestRepo();
    const prevCwd = process.cwd();
    process.chdir(uninit.dir);
    try {
      const result = await handler({});
      assert.equal(result.isError, true);
      assert.equal(result.content[0].text, 'git turn: not initialized. Run `git turn init` first.');
    } finally {
      process.chdir(prevCwd);
      rmSync(uninit.dir, { recursive: true, force: true });
    }
  });
});
