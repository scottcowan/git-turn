'use strict';

// SQLite read cache for git-turn. Source of truth is git refs + notes;
// this is a rebuild-able index for fast log/blame/bisect queries.
// Requires Node 22+ (node:sqlite built-in).

const path = require('path');
// Suppress the experimental warning — node:sqlite is stable enough for our use
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');
process.on('warning', w => { if (!w.name?.includes('ExperimentalWarning') || !w.message?.includes('SQLite')) process.emitWarning(w); });
const { gitDir, gitSafe } = require('./git');
const { NOTES_REF } = require('./session');

function cacheDbPath() {
  return path.join(gitDir(), 'git-turn', 'cache.db');
}

let _db = null;

function openDb() {
  if (_db) return _db;
  const dbPath = cacheDbPath();
  _db = new DatabaseSync(dbPath);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
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
    CREATE TABLE IF NOT EXISTS turn_files (
      id          INTEGER PRIMARY KEY,
      turn_id     INTEGER REFERENCES turns(id) ON DELETE CASCADE,
      file_path   TEXT NOT NULL,
      change_type TEXT,
      insertions  INTEGER,
      deletions   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_turn_files_path ON turn_files(file_path);
    CREATE INDEX IF NOT EXISTS idx_turn_files_turn ON turn_files(turn_id);
  `);
  return _db;
}

function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

// Insert or update a single turn row. Optionally populate turn_files from
// a git diff --numstat against the prior snapshot.
function upsertTurn(db, { sessionId, turnN, snapshotSha, headSha, branch, ts, meta, prevSnapshotSha }) {
  // Parse note metadata
  const prompt = meta?.prompt || null;
  const model = meta?.model || null;
  const latency_ms = meta?.latency_ms || null;

  // Diff stats vs prior snapshot (or vs empty tree for turn 1)
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const diffBase = prevSnapshotSha || EMPTY_TREE;
  const numstat = gitSafe(['diff', '--numstat', diffBase, snapshotSha]) || '';

  let filesChanged = 0, totalIns = 0, totalDel = 0;
  const fileRows = [];
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [ins, del, ...fileParts] = line.split('\t');
    const filePath = fileParts.join('\t');
    if (!filePath) continue;
    const i = parseInt(ins, 10) || 0;
    const d = parseInt(del, 10) || 0;
    filesChanged++;
    totalIns += i;
    totalDel += d;
    const changeType = i > 0 && d === 0 ? 'A' : d > 0 && i === 0 ? 'D' : 'M';
    fileRows.push({ filePath, changeType, i, d });
  }

  const upsert = db.prepare(`
    INSERT INTO turns (session_id, turn_n, snapshot_sha, head_sha, branch, ts,
                       files_changed, insertions, deletions, prompt, model, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, turn_n) DO UPDATE SET
      snapshot_sha  = excluded.snapshot_sha,
      head_sha      = excluded.head_sha,
      branch        = excluded.branch,
      ts            = excluded.ts,
      files_changed = excluded.files_changed,
      insertions    = excluded.insertions,
      deletions     = excluded.deletions,
      prompt        = excluded.prompt,
      model         = excluded.model,
      latency_ms    = excluded.latency_ms
  `);
  upsert.run(sessionId, turnN, snapshotSha, headSha || null, branch || null, ts,
             filesChanged, totalIns, totalDel, prompt, model, latency_ms);

  const turnId = db.prepare('SELECT id FROM turns WHERE session_id=? AND turn_n=?')
                   .get(sessionId, turnN)?.id;
  if (turnId && fileRows.length > 0) {
    db.prepare('DELETE FROM turn_files WHERE turn_id=?').run(turnId);
    const insertFile = db.prepare(`
      INSERT INTO turn_files (turn_id, file_path, change_type, insertions, deletions)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const { filePath, changeType, i, d } of fileRows) {
      insertFile.run(turnId, filePath, changeType, i, d);
    }
  }
}

// Rebuild the cache from scratch by walking all git-turn refs and notes.
function rebuild({ verbose = false } = {}) {
  const db = openDb();

  db.exec('DELETE FROM turn_files; DELETE FROM turns;');

  // Walk all session/turn refs
  const refOutput = gitSafe(['for-each-ref',
    '--format=%(refname) %(objectname)',
    '--sort=refname',
    'refs/git-turn/sessions/']) || '';

  const refs = refOutput.split('\n').filter(Boolean).map(line => {
    const [ref, sha] = line.split(' ');
    return { ref, sha };
  });

  if (verbose) process.stderr.write(`Rebuilding cache from ${refs.length} turn refs...\n`);

  // Group by session to compute prevSnapshotSha for diffs
  const sessions = {};
  for (const { ref, sha } of refs) {
    const m = ref.match(/refs\/git-turn\/sessions\/([^/]+)\/turn-(\d+)/);
    if (!m) continue;
    const [, sessionId, turnNStr] = m;
    const turnN = parseInt(turnNStr, 10);
    if (!sessions[sessionId]) sessions[sessionId] = [];
    sessions[sessionId].push({ turnN, snapshotSha: sha });
  }

  for (const [sessionId, turns] of Object.entries(sessions)) {
    turns.sort((a, b) => a.turnN - b.turnN);
    db.exec('BEGIN');
    try {
      for (let i = 0; i < turns.length; i++) {
        const { turnN, snapshotSha } = turns[i];
        const prevSnapshotSha = i > 0 ? turns[i - 1].snapshotSha : null;

        const msg = gitSafe(['log', '-1', '--format=%B', snapshotSha]) || '';
        let headSha = null, branch = null, ts = new Date(0).toISOString();
        for (const line of msg.split('\n')) {
          if (line.startsWith('head ')) headSha = line.slice(5).trim();
          if (line.startsWith('branch ')) branch = line.slice(7).trim();
          if (line.startsWith('created ')) ts = line.slice(8).trim();
        }

        let meta = {};
        if (headSha) {
          const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', headSha],
            { stdio: ['pipe', 'pipe', 'ignore'] });
          if (note) { try { meta = JSON.parse(note); } catch {} }
        }

        upsertTurn(db, { sessionId, turnN, snapshotSha, headSha, branch, ts, meta, prevSnapshotSha });
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  if (verbose) process.stderr.write(`Cache rebuilt: ${refs.length} turns.\n`);
}

// Ensure cache exists and is populated. Rebuilds from scratch if missing.
function ensureCache() {
  try {
    const db = openDb();
    const count = db.prepare('SELECT COUNT(*) as n FROM turns').get();
    if (count.n === 0) rebuild();
    return db;
  } catch {
    rebuild();
    return openDb();
  }
}

// Insert a single new turn (called from post-commit hook path).
function insertTurn({ sessionId, turnN, snapshotSha, headSha, branch, ts, meta, prevSnapshotSha }) {
  const db = openDb();
  upsertTurn(db, { sessionId, turnN, snapshotSha, headSha, branch, ts, meta, prevSnapshotSha });
}

// Query turns for a session, ordered by turn_n.
function getTurns(sessionId) {
  const db = ensureCache();
  return db.prepare('SELECT * FROM turns WHERE session_id=? ORDER BY turn_n')
           .all(sessionId);
}

// Query files touched in a given turn.
function getTurnFiles(turnId) {
  const db = ensureCache();
  return db.prepare('SELECT * FROM turn_files WHERE turn_id=? ORDER BY file_path')
           .all(turnId);
}

// Query which turns touched a given file path (for blame).
function getTurnsForFile(filePath) {
  const db = ensureCache();
  return db.prepare(`
    SELECT t.*, tf.change_type, tf.insertions, tf.deletions
    FROM turn_files tf JOIN turns t ON t.id = tf.turn_id
    WHERE tf.file_path = ?
    ORDER BY t.session_id, t.turn_n
  `).all(filePath);
}

module.exports = { openDb, closeDb, rebuild, ensureCache, insertTurn, getTurns, getTurnFiles, getTurnsForFile };
