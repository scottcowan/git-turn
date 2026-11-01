'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../../helpers/test-repo');
const { addNote } = require('../../git');
const { NOTES_REF } = require('../../session');
const { handler } = require('./cost');

describe('git_turn_cost tool', () => {
  let dir, origCwd, origHome, repo, session;

  beforeEach(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;
    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    process.env.HOME = dir;

    const { startSession } = require('../../helpers/turn-fixtures');
    session = startSession();

    seedFakePricing(dir, 'claude-sonnet-4-5', {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
    });
  });

  afterEach(() => {
    try { require('../../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  function seedFakePricing(targetDir, modelKey, priceEntry) {
    writeFileSync(join(targetDir, '.git-turn-pricing.json'), JSON.stringify({
      _fetched_at: Date.now(),
      data: { [modelKey]: priceEntry },
    }));
  }

  function seedTurnWithUsage(sess, model, usage) {
    const { makeTurn } = require('../../helpers/turn-fixtures');
    const { headSha, snapshotSha, turn_n } = makeTurn(sess, 'a', repo.git);
    addNote(NOTES_REF, headSha, JSON.stringify({
      session_id: sess.session_id,
      turn_n,
      snapshot_sha: snapshotSha,
      ts: '2026-09-18T00:00:00.000Z',
      model,
      usage,
    }));
    return { headSha, snapshotSha, turn_n };
  }

  test('VERIFY-03: live note round-trip reports model and cost, never [object Promise]', async () => {
    seedTurnWithUsage(session, 'claude-sonnet-4-5', { input_tokens: 1000, output_tokens: 500 });

    const result = await handler({});
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.match(text, /claude-sonnet-4-5/);
    assert.match(text, /\$0\.0105/);
    assert.ok(!text.includes('no model recorded'));
    assert.ok(!text.includes('[object Promise]'));
  });

  test('handler({}) matches compute([])', async () => {
    seedTurnWithUsage(session, 'claude-sonnet-4-5', { input_tokens: 1000, output_tokens: 500 });

    const result = await handler({});
    assert.equal(result.content[0].text, await require('../../commands/cost').compute([]));
  });

  test('handler({ all: true }) matches compute(["--all"])', async () => {
    seedTurnWithUsage(session, 'claude-sonnet-4-5', { input_tokens: 1000, output_tokens: 500 });

    const result = await handler({ all: true });
    assert.equal(result.content[0].text, await require('../../commands/cost').compute(['--all']));
  });

  test('handler returns a Promise', () => {
    const result = handler({});
    assert.ok(result instanceof Promise);
    return result;
  });

  test('MCP-09: pricing load failure returns isError true with exact message', async () => {
    writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({ _fetched_at: 0, data: {} }));

    const https = require('https');
    const origGet = https.get;
    https.get = (url, cb) => {
      const { EventEmitter } = require('events');
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      process.nextTick(() => req.emit('error', new Error('network unreachable')));
      return req;
    };

    try {
      const result = await handler({});
      assert.equal(result.isError, true);
      assert.equal(
        result.content[0].text,
        'git turn: could not load pricing data: network unreachable\nCheck your internet connection or try again later.'
      );
    } finally {
      https.get = origGet;
    }
  });

  test('MCP-09: uninitialized repo returns isError true with exact message', async () => {
    const { gitDir } = require('../../git');
    rmSync(join(gitDir(), 'git-turn', 'session.json'), { force: true });

    const result = await handler({});
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'git turn: not initialized. Run `git turn init` first.');
  });

  test('handler never writes to process.stderr (progress line suppressed)', async () => {
    seedTurnWithUsage(session, 'claude-sonnet-4-5', { input_tokens: 1000, output_tokens: 500 });

    const origWrite = process.stderr.write;
    let calls = 0;
    process.stderr.write = (...args) => { calls++; return origWrite.apply(process.stderr, args); };
    try {
      await handler({});
    } finally {
      process.stderr.write = origWrite;
    }
    assert.equal(calls, 0);
  });
});
