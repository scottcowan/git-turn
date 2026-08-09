'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gitDir, git, gitSafe } = require('./git');

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

function newSession() {
  const session = {
    session_id: crypto.randomUUID(),
    turn_n: 0,
    branch: gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']) || 'HEAD',
    started: new Date().toISOString(),
    preexisting_untracked: (gitSafe(['ls-files', '--others', '--exclude-standard']) || '')
      .split('\n').filter(Boolean),
  };
  writeSession(session);
  return session;
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

// List all turns for a session
function listTurns(sessionId) {
  const prefix = `refs/git-turn/sessions/${sessionId}/`;
  const { listRefs } = require('./git');
  return listRefs(prefix)
    .map(({ ref, sha }) => {
      const n = parseInt(ref.replace(prefix + 'turn-', ''), 10);
      return { turn_n: n, ref, sha };
    })
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
  NOTES_REF,
};
