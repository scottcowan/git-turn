'use strict';

const { gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const withPrompts = args.includes('--with-prompts');
  const noCache = args.includes('--no-cache');

  console.log(`Session: ${session.session_id}\n`);

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
          console.log(`  turn ${String(row.turn_n).padStart(2)}  ${headShort}  ${msg.padEnd(50)}  ${stat}`);
          if (withPrompts && row.prompt) {
            console.log(`         prompt: ${row.prompt.slice(0, 80)}...`);
          }
        }
        return;
      }
    } catch {
      // Cache unavailable — fall through to git object walk
    }
  }

  // Git object walk fallback
  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    console.log('No turns yet this session. Make some commits with an agent.');
    return;
  }

  for (const { turn_n, sha } of turns) {
    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', sha], { stdio: ['pipe', 'pipe', 'ignore'] });
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    const msg = gitSafe(['log', '-1', '--format=%s', meta.head || sha]) || '';
    const stat = gitSafe(['diff', '--shortstat', `${sha}^..${sha}`]) || '';
    const shortStat = stat.replace(/\s+/g, ' ').trim();

    console.log(`  turn ${String(turn_n).padStart(2)}  ${(meta.head || sha).slice(0, 7)}  ${msg.slice(0, 50).padEnd(50)}  ${shortStat}`);

    if (withPrompts && meta.prompt) {
      console.log(`         prompt: ${meta.prompt.slice(0, 80)}...`);
    }
  }
}

module.exports = { run };
