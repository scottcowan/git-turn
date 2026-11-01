'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const { makeTestRepo } = require('../../helpers/test-repo');
const { addNote } = require('../../git');
const { NOTES_REF } = require('../../session');
const { handler } = require('./show');

describe('git_turn_show tool', () => {
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

  test('handler({ turn: 1 }) matches compute(["1"], { color: false })', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id,
      turn_n: 1,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
    }));

    const result = await handler({ turn: 1 });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, require('../../commands/show').compute(['1'], { color: false }));
  });

  test('VERIFY-03: git_turn_show reads a real hook-written note, not a hand-built fixture', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id,
      turn_n: 1,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
      model: 'claude-sonnet-4-5',
      prompt: 'show roundtrip prompt',
      tool_summary: { Read: 2, Edit: 1 },
    }));

    const withPrompts = await handler({ turn: 1, withPrompts: true });
    assert.equal(withPrompts.isError, undefined);
    const withText = withPrompts.content[0].text;
    assert.match(withText, /Model: claude-sonnet-4-5/);
    assert.match(withText, /Tool summary: Read:2, Edit:1/);
    assert.match(withText, /show roundtrip prompt/);

    const withoutPrompts = await handler({ turn: 1 });
    assert.ok(!withoutPrompts.content[0].text.includes('show roundtrip prompt'));
  });

  test('D-02/MCP-10: FORCE_COLOR set, NO_COLOR unset — output contains no ANSI escapes', async () => {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    const { headSha, snapshotSha } = makeTurn(session, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: session.session_id,
      turn_n: 1,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
    }));

    const origForceColor = process.env.FORCE_COLOR;
    const origNoColor = process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    try {
      const result = await handler({ turn: 1 });
      assert.ok(!result.content[0].text.includes('\x1b['));
    } finally {
      if (origForceColor === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForceColor;
      if (origNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNoColor;
    }
  });

  test('MCP-09: out-of-range turn returns isError true, exact message, never throws', async () => {
    const result = await handler({ turn: 999 });
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
      assert.equal(result.content[0].text, 'git turn: not initialized');
    } finally {
      process.chdir(prevCwd);
      rmSync(uninit.dir, { recursive: true, force: true });
    }
  });
});
