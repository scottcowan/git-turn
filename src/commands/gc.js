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
  }
}

module.exports = { run };
