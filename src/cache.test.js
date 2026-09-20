'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { rmSync } = require('fs');
const path = require('path');
const { makeTestRepo } = require('./helpers/test-repo');

describe('cache schema migration', () => {
  let dir;
  let origCwd;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    process.chdir(dir);
    require('./session').ensureDirs();
  });

  afterEach(() => {
    const { closeDb } = require('./cache');
    closeDb();
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('adds usage and tool_summary columns on a fresh db', () => {
    const { openDb } = require('./cache');
    const db = openDb();
    const columns = db.prepare('PRAGMA table_info(turns)').all().map(c => c.name);
    assert.ok(columns.includes('usage'));
    assert.ok(columns.includes('tool_summary'));
  });

  test('is idempotent across repeated opens', () => {
    const { openDb, closeDb } = require('./cache');
    openDb();
    closeDb();
    const db = openDb();
    const columns = db.prepare('PRAGMA table_info(turns)').all().map(c => c.name);
    assert.ok(columns.includes('usage'));
    assert.ok(columns.includes('tool_summary'));

    assert.throws(
      () => db.exec('ALTER TABLE turns ADD COLUMN usage TEXT'),
      /duplicate column name/
    );
  });

  test('upgrades a legacy pre-v0.3 db without losing rows', () => {
    const { closeDb } = require('./cache');
    closeDb();
    const { DatabaseSync } = require('node:sqlite');
    const { gitDir } = require('./git');
    const dbPath = path.join(gitDir(), 'git-turn', 'cache.db');

    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE turns (
        id            INTEGER PRIMARY KEY,
        session_id    TEXT NOT NULL,
        turn_n        INTEGER NOT NULL,
        snapshot_sha  TEXT NOT NULL,
        head_sha      TEXT,
        branch        TEXT,
        ts            TEXT NOT NULL,
        files_changed INTEGER,
        insertions    INTEGER,
        deletions     INTEGER,
        prompt        TEXT,
        model         TEXT,
        latency_ms    INTEGER,
        UNIQUE(session_id, turn_n)
      );
    `);
    legacyDb.prepare(`
      INSERT INTO turns (session_id, turn_n, snapshot_sha, ts)
      VALUES (?, ?, ?, ?)
    `).run('legacy', 1, 'abc', '2026-01-01T00:00:00.000Z');
    legacyDb.close();

    const { openDb } = require('./cache');
    const db = openDb();
    const columns = db.prepare('PRAGMA table_info(turns)').all().map(c => c.name);
    assert.ok(columns.includes('usage'));
    assert.ok(columns.includes('tool_summary'));

    const row = db.prepare('SELECT * FROM turns WHERE session_id=? AND turn_n=?').get('legacy', 1);
    assert.ok(row);
    assert.equal(row.usage, null);
    assert.equal(row.tool_summary, null);
  });
});

describe('upsertTurn usage/tool_summary', () => {
  let dir;
  let origCwd;
  let git;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    git = repo.git;
    process.chdir(dir);
    require('./session').ensureDirs();
  });

  afterEach(() => {
    const { closeDb } = require('./cache');
    closeDb();
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('persists usage and tool_summary as JSON text', () => {
    const { insertTurn, getTurns } = require('./cache');
    const headSha = git(['rev-parse', 'HEAD']);
    const meta = {
      prompt: 'p',
      model: 'm',
      latency_ms: 1234,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 },
      tool_summary: { Read: 5, Edit: 2, Bash: 1 },
    };
    insertTurn({
      sessionId: 's1',
      turnN: 1,
      snapshotSha: headSha,
      headSha,
      branch: 'main',
      ts: new Date().toISOString(),
      meta,
      prevSnapshotSha: null,
    });

    const row = getTurns('s1')[0];
    assert.deepEqual(JSON.parse(row.usage), {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 1,
    });
    assert.deepEqual(JSON.parse(row.tool_summary), { Read: 5, Edit: 2, Bash: 1 });
    assert.equal(row.latency_ms, 1234);
  });

  test('leaves usage and tool_summary null when meta omits them', () => {
    const { insertTurn, getTurns } = require('./cache');
    const headSha = git(['rev-parse', 'HEAD']);
    insertTurn({
      sessionId: 's1',
      turnN: 1,
      snapshotSha: headSha,
      headSha,
      branch: 'main',
      ts: new Date().toISOString(),
      meta: { prompt: 'p' },
      prevSnapshotSha: null,
    });

    const row = getTurns('s1')[0];
    assert.equal(row.usage, null);
    assert.equal(row.tool_summary, null);
  });
});

describe('updatePromptFields', () => {
  let dir;
  let origCwd;
  let git;

  beforeEach(() => {
    origCwd = process.cwd();
    const repo = makeTestRepo();
    dir = repo.dir;
    git = repo.git;
    process.chdir(dir);
    require('./session').ensureDirs();
  });

  afterEach(() => {
    const { closeDb } = require('./cache');
    closeDb();
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  test('writes only the supplied fields and preserves the rest (D-03)', () => {
    const { insertTurn, getTurns, updatePromptFields } = require('./cache');
    const headSha = git(['rev-parse', 'HEAD']);
    insertTurn({
      sessionId: 's1',
      turnN: 1,
      snapshotSha: headSha,
      headSha,
      branch: 'main',
      ts: new Date().toISOString(),
      meta: { prompt: 'original', model: 'm1' },
      prevSnapshotSha: null,
    });

    updatePromptFields('s1', 1, {
      latencyMs: 900,
      usage: { input_tokens: 7 },
      toolSummary: { Read: 1 },
    });

    const row = getTurns('s1')[0];
    assert.equal(row.prompt, 'original');
    assert.equal(row.model, 'm1');
    assert.equal(row.latency_ms, 900);
    assert.equal(JSON.parse(row.usage).input_tokens, 7);
    assert.equal(JSON.parse(row.tool_summary).Read, 1);
  });

  test('is a no-op when the target row does not exist', () => {
    const { updatePromptFields, getTurns } = require('./cache');
    assert.doesNotThrow(() => updatePromptFields('nope', 42, { prompt: 'x' }));
    assert.deepEqual(getTurns('nope'), []);
  });
});
