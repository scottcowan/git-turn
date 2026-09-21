'use strict';

const { listRefs, deleteRef, gitSafe } = require('../git');
const { readSession } = require('../session');

const SESSION_PREFIX = 'refs/git-turn/sessions/';

function listSessionsByAge() {
  const out = gitSafe([
    'for-each-ref',
    '--format=%(refname) %(creatordate:iso-strict)',
    '--sort=creatordate',
    SESSION_PREFIX,
  ]);
  if (!out) return [];

  const seen = new Set();
  const sessions = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const refname = line.split(' ')[0];
    const sessionId = refname.replace(SESSION_PREFIX, '').split('/')[0];
    if (!seen.has(sessionId)) {
      seen.add(sessionId);
      sessions.push(sessionId);
    }
  }
  return sessions;
}

function run(args) {
  if (args.includes('--purge-notes')) {
    const { purgeNotesHistory } = require('../git');
    const { NOTES_REF } = require('../session');
    console.error('git turn gc: this permanently deletes ALL unreachable objects in this');
    console.error('repository (git gc --prune=now is not scoped to notes) — including any');
    console.error('dangling commits with no ref protecting them, and discards note history for');
    console.error('EVERY commit\'s note, not just the one that leaked.');
    let result;
    try {
      result = purgeNotesHistory(NOTES_REF);
    } catch (e) {
      console.error(`git turn gc: notes ref rewritten but pruning failed: ${e.message}`);
      console.error('The old note blob may still be reachable — rerun with no other git process active.');
      process.exit(1);
    }
    if (!result.purged) {
      console.log(`Nothing to purge: ${result.reason}`);
      return;
    }
    console.log(`Purged notes history for ${NOTES_REF} (old tip ${result.oldSha.slice(0, 7)} -> new tip ${result.newSha.slice(0, 7)}).`);
    console.log('Old note blobs are now unreachable and have been pruned.');
    return;
  }

  if (args.includes('--rebuild')) {
    try {
      const { rebuild } = require('../cache');
      rebuild({ verbose: true });
      console.log('Cache rebuilt.');
    } catch (e) {
      console.error('git turn gc: cache rebuild failed:', e.message);
      process.exit(1);
    }
    return;
  }

  const keepIdx = args.indexOf('--keep-sessions');
  let keepN = 10;
  if (keepIdx !== -1) {
    keepN = parseInt(args[keepIdx + 1], 10);
    if (isNaN(keepN)) {
      console.error('git turn gc: --keep-sessions requires a number');
      process.exit(1);
    }
  }

  const currentSession = readSession();
  const allSessions = listSessionsByAge();
  const toDelete = allSessions.slice(0, Math.max(0, allSessions.length - keepN));

  let pruned = 0;
  for (const sessionId of toDelete) {
    if (currentSession && sessionId === currentSession.session_id) {
      continue;
    }
    const refs = listRefs(SESSION_PREFIX + sessionId + '/');
    for (const { ref } of refs) {
      deleteRef(ref);
    }
    pruned += refs.length;
    console.log('Pruned session ' + sessionId + ' (' + refs.length + ' turns)');
  }

  if (pruned > 0) {
    console.log("Snapshot objects will be reclaimed on next 'git gc'");
    // Invalidate stale cache entries for pruned sessions
    try {
      const { rebuild } = require('../cache');
      rebuild();
    } catch {}
  }
}

module.exports = { run };
