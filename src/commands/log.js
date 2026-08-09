'use strict';

const { git, gitSafe } = require('../git');
const { readSession, listTurns, NOTES_REF } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const turns = listTurns(session.session_id);
  if (turns.length === 0) {
    console.log('No turns yet this session. Make some commits with an agent.');
    return;
  }

  const withPrompts = args.includes('--with-prompts');

  console.log(`Session: ${session.session_id}\n`);

  for (const { turn_n, sha } of turns) {
    // Get note for this snapshot
    const note = gitSafe(['notes', `--ref=${NOTES_REF}`, 'show', sha]);
    let meta = {};
    try { meta = note ? JSON.parse(note) : {}; } catch {}

    // Get commit info at HEAD for this turn (stored in snapshot message)
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
