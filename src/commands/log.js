'use strict';

const { gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');
const { parseSnapshotMessage } = require('../blame-util');

// Build the --json array for both the cache path and the git object walk
// fallback, sharing the exact same data sources as the text path in
// compute() so the two never drift (RESEARCH Pitfall 5: resolve
// parseSnapshotMessage exactly once per turn).
function computeJson(session, { withPrompts, noCache }) {
  if (!noCache) {
    try {
      const { getTurns } = require('../cache');
      const cached = getTurns(session.session_id);
      if (cached.length > 0) {
        const turnsArr = [];
        for (const row of cached) {
          const subject = row.head_sha
            ? (gitSafe(['log', '-1', '--format=%s', row.head_sha]) || '')
            : '';
          const obj = {
            turn: row.turn_n,
            sha: row.head_sha || row.snapshot_sha,
            snapshot_sha: row.snapshot_sha,
            subject,
            files_changed: row.files_changed,
            insertions: row.insertions,
            deletions: row.deletions,
          };
          if (withPrompts && row.prompt) obj.prompt = row.prompt;
          turnsArr.push(obj);
        }
        return JSON.stringify(turnsArr);
      }
    } catch {
      // Cache unavailable — fall through to git object walk
    }
  }

  const turns = listTurns(session.session_id);
  if (turns.length === 0) return '[]';

  const turnsArr = [];
  for (const { turn_n, sha } of turns) {
    // Real HEAD sha lives in the snapshot commit's own message body, not
    // notes — refs/notes/git-turn has never carried a `head` field.
    const { headSha } = parseSnapshotMessage(sha);
    const head = headSha || sha;

    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head], { stdio: ['pipe', 'pipe', 'ignore'] });
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    const subject = gitSafe(['log', '-1', '--format=%s', head]) || '';
    const stat = gitSafe(['diff', '--shortstat', `${sha}^..${sha}`]) || '';
    const shortStat = stat.replace(/\s+/g, ' ').trim();

    let files_changed = null, insertions = null, deletions = null;
    if (shortStat) {
      const fm = /(\d+) files? changed/.exec(shortStat);
      const im = /(\d+) insertions?\(\+\)/.exec(shortStat);
      const dm = /(\d+) deletions?\(-\)/.exec(shortStat);
      files_changed = fm ? parseInt(fm[1], 10) : 0;
      insertions = im ? parseInt(im[1], 10) : 0;
      deletions = dm ? parseInt(dm[1], 10) : 0;
    }

    const obj = { turn: turn_n, sha: head, snapshot_sha: sha, subject, files_changed, insertions, deletions };
    if (withPrompts && meta.prompt) obj.prompt = meta.prompt;
    turnsArr.push(obj);
  }

  return JSON.stringify(turnsArr);
}

function compute(args, opts = {}) {
  const session = readSession();
  if (!session) {
    throw new Error('git turn: not initialized. Run `git turn init` first.');
  }

  const withPrompts = args.includes('--with-prompts');
  const noCache = args.includes('--no-cache');
  const json = args.includes('--json');

  if (json) {
    return computeJson(session, { withPrompts, noCache });
  }

  const lines = [];
  lines.push(`Session: ${session.session_id}\n`);

  // Try cache first, fall back to git object walk
  if (!noCache) {
    try {
      const { getTurns } = require('../cache');
      const cached = getTurns(session.session_id);
      if (cached.length > 0) {
        for (const row of cached) {
          const headShort = (row.head_sha || row.snapshot_sha).slice(0, 7);
          const msg = row.head_sha
            ? (gitSafe(['log', '-1', '--format=%s', row.head_sha]) || '').slice(0, 50)
            : '';
          const stat = [row.files_changed, 'files', row.insertions && `+${row.insertions}`, row.deletions && `-${row.deletions}`]
            .filter(Boolean).join(' ');
          lines.push(`  turn ${String(row.turn_n).padStart(2)}  ${headShort}  ${msg.padEnd(50)}  ${stat}`);
          if (withPrompts && row.prompt) {
            lines.push(`         prompt: ${row.prompt.slice(0, 80)}...`);
          }
        }
        return lines.join('\n');
      }
    } catch {
      // Cache unavailable — fall through to git object walk
    }
  }

  // Git object walk fallback
  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    lines.push('No turns yet this session. Make some commits with an agent.');
    return lines.join('\n');
  }

  for (const { turn_n, sha } of turns) {
    // Real HEAD sha lives in the snapshot commit's own message body, not
    // notes — refs/notes/git-turn has never carried a `head` field.
    const { headSha } = parseSnapshotMessage(sha);
    const head = headSha || sha;

    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', head], { stdio: ['pipe', 'pipe', 'ignore'] });
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    const msg = gitSafe(['log', '-1', '--format=%s', head]) || '';
    const stat = gitSafe(['diff', '--shortstat', `${sha}^..${sha}`]) || '';
    const shortStat = stat.replace(/\s+/g, ' ').trim();

    lines.push(`  turn ${String(turn_n).padStart(2)}  ${head.slice(0, 7)}  ${msg.slice(0, 50).padEnd(50)}  ${shortStat}`);

    if (withPrompts && meta.prompt) {
      lines.push(`         prompt: ${meta.prompt.slice(0, 80)}...`);
    }
  }

  return lines.join('\n');
}

function run(args) {
  try {
    console.log(compute(args, { stderr: (s) => process.stderr.write(s) }));
  } catch (e) {
    if (args.includes('--json')) {
      console.log(JSON.stringify({ error: e.message }));
      process.exit(1);
      return;
    }
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { run, compute };
