'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gitDir, git, gitSafe, updateRef, writeBlob, readBlob, listRefs } = require('./git');

const NOTES_REF = 'refs/notes/git-turn';

function sessionPath() {
  return path.join(gitDir(), 'git-turn', 'session.json');
}

function opsDir() {
  return path.join(gitDir(), 'git-turn', 'ops');
}

function ensureDirs() {
  const base = path.join(gitDir(), 'git-turn');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(base, 'ops'), { recursive: true });
}

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeSession(data) {
  ensureDirs();
  fs.writeFileSync(sessionPath(), JSON.stringify(data, null, 2));
}

// Ref holding a session's durable metadata blob (forked_from lineage, started, branch).
// Unlike session.json (single mutable slot, overwritten by the next newSession()),
// this ref persists per-session so lineage survives after the session is no longer active.
function sessionMetaRef(sessionId) {
  return `refs/git-turn/sessions/${sessionId}/meta`;
}

// forkedFrom: optional { session_id, turn_n } — the turn this session branched from.
function newSession(forkedFrom = null) {
  const session = {
    session_id: crypto.randomUUID(),
    turn_n: 0,
    branch: gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD',
    started: new Date().toISOString(),
    preexisting_untracked: (gitSafe(['ls-files', '--others', '--exclude-standard']) || '')
      .split('\n').filter(Boolean),
    forked_from: forkedFrom || null,
  };
  writeSession(session);

  const meta = JSON.stringify({
    session_id: session.session_id,
    started: session.started,
    branch: session.branch,
    forked_from: session.forked_from,
  });
  updateRef(sessionMetaRef(session.session_id), writeBlob(meta));

  return session;
}

// Read a session's durable metadata (survives after the session is no longer active).
// Returns null if no meta ref exists for this session_id.
function readSessionMeta(sessionId) {
  const sha = gitSafe(['rev-parse', sessionMetaRef(sessionId)]);
  if (!sha) return null;
  const blob = readBlob(sha);
  if (!blob) return null;
  try {
    return JSON.parse(blob);
  } catch {
    return null;
  }
}

// Every session_id that has ever had a turn or meta ref written — the
// full lineage-queryable set, not just the currently-active session.json.
function listSessionIds() {
  const ids = new Set();
  for (const { ref } of listRefs('refs/git-turn/sessions/')) {
    const m = ref.match(/^refs\/git-turn\/sessions\/([^/]+)\//);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

function incrementTurn(session) {
  session.turn_n += 1;
  writeSession(session);
  return session;
}

// Turn ref path
function turnRef(sessionId, turnN) {
  return `refs/git-turn/sessions/${sessionId}/turn-${turnN}`;
}

// List all turns for a session. Excludes non-turn refs (e.g. the session's
// durable `meta` ref) by requiring the `turn-<N>` suffix — a bare regex match
// rather than a prefix-strip, so unrelated ref suffixes can't parse as NaN turns.
function listTurns(sessionId) {
  const prefix = `refs/git-turn/sessions/${sessionId}/`;
  return listRefs(prefix)
    .map(({ ref, sha }) => {
      const m = ref.match(/\/turn-(\d+)$/);
      return m ? { turn_n: parseInt(m[1], 10), ref, sha } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.turn_n - b.turn_n);
}

// Write operation log entry (jj-style)
function writeOp(type, data) {
  ensureDirs();
  const entry = { type, ts: new Date().toISOString(), ...data };
  const hash = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  fs.writeFileSync(path.join(opsDir(), hash), JSON.stringify(entry, null, 2));
  return hash;
}

// Read all ops in order
function readOps() {
  try {
    return fs.readdirSync(opsDir())
      .map(f => JSON.parse(fs.readFileSync(path.join(opsDir(), f), 'utf8')))
      .sort((a, b) => a.ts.localeCompare(b.ts));
  } catch {
    return [];
  }
}

module.exports = {
  sessionPath, ensureDirs, readSession, writeSession, newSession,
  incrementTurn, turnRef, listTurns, writeOp, readOps,
  sessionMetaRef, readSessionMeta, listSessionIds,
  NOTES_REF,
};
