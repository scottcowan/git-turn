'use strict';

const { readSession, newSession, listTurns, listSessionIds, readSessionMeta } = require('../session');

// Parses "<session_id>:<turn_n>" — session_id may itself contain no ':', so
// splitting on the LAST ':' keeps this correct even for UUID session ids.
function parseFromArg(fromStr) {
  const idx = fromStr.lastIndexOf(':');
  if (idx === -1) return null;
  const sessionId = fromStr.slice(0, idx);
  const turnN = parseInt(fromStr.slice(idx + 1), 10);
  if (!sessionId || Number.isNaN(turnN)) return null;
  return { session_id: sessionId, turn_n: turnN };
}

function runNew(args) {
  const fromIdx = args.indexOf('--from');
  let forkedFrom = null;

  if (fromIdx !== -1) {
    const raw = args[fromIdx + 1];
    forkedFrom = raw ? parseFromArg(raw) : null;
    if (!forkedFrom) {
      console.error('git turn: --from requires <session_id>:<turn_n>');
      process.exit(1);
    }
    const turns = listTurns(forkedFrom.session_id);
    const found = turns.find(t => t.turn_n === forkedFrom.turn_n);
    if (!found) {
      console.error(`git turn: turn ${forkedFrom.turn_n} not found in session ${forkedFrom.session_id}`);
      process.exit(1);
    }
  }

  const session = newSession(forkedFrom);
  console.log(`Started session: ${session.session_id}`);
  if (forkedFrom) {
    console.log(`Forked from: ${forkedFrom.session_id} turn ${forkedFrom.turn_n}`);
  }
}

function runList() {
  const current = readSession();
  const ids = listSessionIds();

  if (ids.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const id of ids) {
    const marker = current && current.session_id === id ? '* ' : '  ';
    const turns = listTurns(id);
    const meta = readSessionMeta(id);
    const lineage = meta && meta.forked_from
      ? `  forked from ${meta.forked_from.session_id} turn ${meta.forked_from.turn_n}`
      : '';
    console.log(`${marker}${id}  (${turns.length} turn${turns.length === 1 ? '' : 's'})${lineage}`);
  }
}

function run(args) {
  const sub = args[0];
  if (sub === 'new') return runNew(args.slice(1));
  if (sub === 'list') return runList();

  console.error('Usage: git turn session new [--from <session_id>:<turn_n>] | git turn session list');
  process.exit(1);
}

module.exports = { run };
