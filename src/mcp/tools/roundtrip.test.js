'use strict';

// VERIFY-03: live round-trip across all 5 read-only MCP tools.
//
// Unlike the per-tool test files (show.test.js/log.test.js/...), this file
// never hand-builds a note via helpers/fixtures. It writes the note the way
// a real agent session would: `git turn init` installs the real post-commit hook,
// a real `git commit` fires it, and the real `git turn record-prompt` CLI
// enriches the note afterward. This is the only test proving the
// snapshot-sha-vs-HEAD-sha lookup (PITFALLS.md Pitfall 5) resolves
// correctly without a hand-built fixture that could encode the wrong
// assumption about which sha the note lives on.

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { rmSync, writeFileSync } = require('fs');
const { join } = require('path');
const { makeTestRepo } = require('../../helpers/test-repo');
const { readSession } = require('../../session');

const show = require('./show');
const log = require('./log');
const cost = require('./cost');
const diff = require('./diff');
const blame = require('./blame');

const BIN_PATH = join(__dirname, '..', '..', '..', 'bin', 'git-turn');

describe('VERIFY-03: live round-trip through all 5 MCP tool handlers', () => {
  let dir, origCwd, origHome, repo, sessionId;

  before(() => {
    origCwd = process.cwd();
    origHome = process.env.HOME;

    repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    process.env.HOME = dir;

    // Seed the pricing cache so git_turn_cost never attempts a network fetch.
    writeFileSync(join(dir, '.git-turn-pricing.json'), JSON.stringify({
      _fetched_at: Date.now(),
      data: {
        'claude-sonnet-4-5': {
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
        },
      },
    }));

    const env = { ...process.env, HOME: dir };

    // Real `git turn init` — installs the production post-commit hook and
    // starts a session. No fixture stands in for this.
    execFileSync(process.execPath, [BIN_PATH, 'init'], { cwd: dir, env, encoding: 'utf8' });

    // Turn 1: a real commit fires the real hook, then the real
    // record-prompt CLI enriches that turn's note.
    writeFileSync(join(dir, 'work.txt'), 'v1\n');
    repo.git(['add', 'work.txt']);
    repo.git(['commit', '-q', '-m', 'roundtrip turn 1']);
    execFileSync(process.execPath, [BIN_PATH, 'record-prompt'], {
      cwd: dir,
      env,
      encoding: 'utf8',
      input: JSON.stringify({
        prompt: 'roundtrip turn one prompt',
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1000, output_tokens: 500 },
        latency_ms: 1234,
        tool_summary: { Read: 2, Edit: 1 },
      }),
    });

    // Turn 2: another real commit, another real record-prompt call.
    writeFileSync(join(dir, 'work.txt'), 'v1\nv2\n');
    repo.git(['add', 'work.txt']);
    repo.git(['commit', '-q', '-m', 'roundtrip turn 2']);
    execFileSync(process.execPath, [BIN_PATH, 'record-prompt'], {
      cwd: dir,
      env,
      encoding: 'utf8',
      input: JSON.stringify({
        prompt: 'roundtrip turn two prompt',
        model: 'claude-sonnet-4-5',
        tool_summary: { Bash: 3 },
      }),
    });

    const session = readSession();
    assert.ok(session, 'VERIFY-03 precondition: readSession() returned null — git turn init did not create a session');
    sessionId = session.session_id;

    // Precondition: the note on HEAD must carry turn_n 2 and a snapshot_sha
    // that differs from HEAD's own sha — this is exactly the shape Pitfall 5
    // warns about (note lives on the real commit sha, keyed by the hook's
    // own HEAD-at-commit-time, not by the dangling snapshot sha).
    const headSha = repo.git(['rev-parse', 'HEAD']);
    const noteRawHead = repo.git(['notes', '--ref=refs/notes/git-turn', 'show', 'HEAD']);
    let noteHead;
    try {
      noteHead = JSON.parse(noteRawHead);
    } catch (e) {
      throw new Error(`VERIFY-03 precondition: note on HEAD is not valid JSON — the post-commit hook did not fire as expected: ${e.message}`);
    }
    assert.equal(noteHead.turn_n, 2, 'VERIFY-03 precondition: HEAD note turn_n must be 2 — the post-commit hook did not fire on the second commit');
    assert.equal(noteHead.session_id, sessionId, 'VERIFY-03 precondition: HEAD note session_id must match the active session');
    const snapshotSha2 = repo.git(['rev-parse', `refs/git-turn/sessions/${sessionId}/turn-2`]);
    assert.equal(noteHead.snapshot_sha, snapshotSha2, 'VERIFY-03 precondition: HEAD note snapshot_sha must match the turn-2 snapshot ref');
    assert.notEqual(noteHead.snapshot_sha, headSha, 'VERIFY-03 precondition: snapshot_sha must differ from HEAD sha (Pitfall 5 shape)');

    // Same check for the prior commit (turn 1).
    const headSha1 = repo.git(['rev-parse', 'HEAD~1']);
    const noteRawHead1 = repo.git(['notes', '--ref=refs/notes/git-turn', 'show', 'HEAD~1']);
    let noteHead1;
    try {
      noteHead1 = JSON.parse(noteRawHead1);
    } catch (e) {
      throw new Error(`VERIFY-03 precondition: note on HEAD~1 is not valid JSON — the post-commit hook did not fire as expected: ${e.message}`);
    }
    assert.equal(noteHead1.turn_n, 1, 'VERIFY-03 precondition: HEAD~1 note turn_n must be 1');
    assert.equal(noteHead1.session_id, sessionId, 'VERIFY-03 precondition: HEAD~1 note session_id must match the active session');
    const snapshotSha1 = repo.git(['rev-parse', `refs/git-turn/sessions/${sessionId}/turn-1`]);
    assert.equal(noteHead1.snapshot_sha, snapshotSha1, 'VERIFY-03 precondition: HEAD~1 note snapshot_sha must match the turn-1 snapshot ref');
    assert.notEqual(noteHead1.snapshot_sha, headSha1, 'VERIFY-03 precondition: snapshot_sha must differ from HEAD~1 sha (Pitfall 5 shape)');
  });

  after(() => {
    try { require('../../cache').closeDb(); } catch {}
    process.chdir(origCwd);
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  test('VERIFY-03: git_turn_show reads real hook+record-prompt notes', async () => {
    const turn1 = await show.handler({ turn: 1, withPrompts: true });
    assert.equal(turn1.isError, undefined);
    const text1 = turn1.content[0].text;
    assert.match(text1, /Model: claude-sonnet-4-5/);
    assert.match(text1, /Latency: 1234ms/);
    assert.match(text1, /Tool summary: Read:2, Edit:1/);
    assert.match(text1, /roundtrip turn one prompt/);

    const turn2 = await show.handler({ turn: 2 });
    assert.equal(turn2.isError, undefined);
    const text2 = turn2.content[0].text;
    assert.match(text2, /Tool summary: Bash:3/);
    assert.ok(!text2.includes('roundtrip turn two prompt'));
  });

  test('VERIFY-03: git_turn_log reads real hook+record-prompt notes (cache and no-cache)', async () => {
    const noCache = await log.handler({ withPrompts: true, noCache: true });
    assert.equal(noCache.isError, undefined);
    const textNoCache = noCache.content[0].text;
    assert.match(textNoCache, /prompt: roundtrip turn one prompt/);
    assert.match(textNoCache, /prompt: roundtrip turn two prompt/);
    assert.match(textNoCache, /roundtrip turn 1/);

    const cached = await log.handler({ withPrompts: true });
    assert.equal(cached.isError, undefined);
    const textCached = cached.content[0].text;
    assert.match(textCached, /prompt: roundtrip turn one prompt/);
    assert.match(textCached, /prompt: roundtrip turn two prompt/);
  });

  test('VERIFY-03: git_turn_cost reads real usage recorded via record-prompt', async () => {
    const result = await cost.handler({});
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.match(text, /claude-sonnet-4-5/);
    assert.match(text, /\$0\.0105/);
    assert.ok(!text.includes('no model recorded'));
    assert.ok(!text.includes('[object Promise]'));
  });

  test('VERIFY-03: git_turn_diff reads real snapshots created by the production hook', async () => {
    const turn2 = await diff.handler({ turn: 2 });
    assert.equal(turn2.isError, undefined);
    assert.match(turn2.content[0].text, /\+ v2$/m);
    assert.ok(!/^- v1$/m.test(turn2.content[0].text));

    const explicit = await diff.handler({ turn: 1, toTurn: 2 });
    assert.equal(explicit.isError, undefined);
    assert.equal(
      explicit.content[0].text,
      require('../../commands/diff').compute(['1', '2'], { color: false })
    );
  });

  test('VERIFY-03: git_turn_blame reads real per-turn attribution from the production hook', async () => {
    const sid8 = sessionId.slice(0, 8);

    const withCache = await blame.handler({ file: 'work.txt' });
    assert.equal(withCache.isError, undefined);
    const linesCache = withCache.content[0].text.split('\n');
    const v1LineCache = linesCache.find(l => l.includes('v1'));
    const v2LineCache = linesCache.find(l => l.includes('v2'));
    assert.match(v1LineCache, new RegExp(`${sid8}:1`));
    assert.match(v2LineCache, new RegExp(`${sid8}:2`));

    const noCache = await blame.handler({ file: 'work.txt', noCache: true });
    assert.equal(noCache.isError, undefined);
    const linesNoCache = noCache.content[0].text.split('\n');
    const v1LineNoCache = linesNoCache.find(l => l.includes('v1'));
    const v2LineNoCache = linesNoCache.find(l => l.includes('v2'));
    assert.match(v1LineNoCache, new RegExp(`${sid8}:1`));
    assert.match(v2LineNoCache, new RegExp(`${sid8}:2`));
  });

  test('MCP-10 on live data: FORCE_COLOR set, NO_COLOR unset — show/diff output has no ANSI escapes', async () => {
    const origForceColor = process.env.FORCE_COLOR;
    const origNoColor = process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    try {
      const showResult = await show.handler({ turn: 1 });
      assert.ok(!showResult.content[0].text.includes('\x1b['));

      const diffResult = await diff.handler({ turn: 2 });
      assert.ok(!diffResult.content[0].text.includes('\x1b['));
    } finally {
      if (origForceColor === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = origForceColor;
      if (origNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = origNoColor;
    }
  });

  test('MCP-09 on live data: out-of-range turn returns isError true with exact message', async () => {
    const result = await show.handler({ turn: 3 });
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'git turn: turn 3 not found');
  });
});
