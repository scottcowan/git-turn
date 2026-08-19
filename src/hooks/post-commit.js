'use strict';

// Post-commit hook — called after every git commit.
// Serialized via a pending-promise chain to prevent concurrent writes.

const { headSha, currentBranch, updateRef, addNote, snapshotWorktree, gitSafe } = require('../git');
const { readSession, incrementTurn, turnRef, writeOp, NOTES_REF } = require('../session');
const { insertTurn } = require('../cache');

let pending = Promise.resolve();

function run() {
  pending = pending.then(createCheckpoint).catch(err => {
    // Never crash the commit — log to stderr only
    process.stderr.write(`git-turn: checkpoint failed: ${err.message}\n`);
  });
}

async function createCheckpoint() {
  const session = readSession();
  if (!session) return; // not a git-turn repo — silent no-op

  const head = headSha();
  const branch = currentBranch();
  const ts = new Date().toISOString();
  const turnN = session.turn_n + 1;

  // Write before-op to op log
  writeOp('before-turn', { session_id: session.session_id, turn_n: turnN, head, branch, ts });

  // Create dangling snapshot (index-tree + worktree-tree)
  const message = [
    `turn ${turnN}`,
    `session ${session.session_id}`,
    `turn_n ${turnN}`,
    `trigger post-commit`,
    `head ${head}`,
    `branch ${branch}`,
    `created ${ts}`,
  ].join('\n');

  const { commitSha, untrackedFiles } = snapshotWorktree({ message });

  // Write turn ref
  const ref = turnRef(session.session_id, turnN);
  updateRef(ref, commitSha);

  // Write note on HEAD commit with session metadata
  const notePayload = JSON.stringify({
    session_id: session.session_id,
    turn_n: turnN,
    snapshot_sha: commitSha,
    ts,
  });
  addNote(NOTES_REF, head, notePayload);

  // Advance turn counter
  incrementTurn(session);

  // Insert into SQLite cache (best-effort — never crash the commit)
  try {
    const { commitSha: prevSnapshotSha } = (() => {
      // Previous turn's snapshot sha for diff baseline
      const prevRef = turnRef(session.session_id, turnN - 1);
      const prevSha = gitSafe(['rev-parse', prevRef]);
      return { commitSha: prevSha };
    })();
    insertTurn({
      sessionId: session.session_id,
      turnN,
      snapshotSha: commitSha,
      headSha: head,
      branch,
      ts,
      meta: {},
      prevSnapshotSha,
    });
  } catch {}

  // Write after-op to op log
  writeOp('after-turn', {
    session_id: session.session_id,
    turn_n: turnN,
    head,
    snapshot_sha: commitSha,
    ref,
    branch,
    ts: new Date().toISOString(),
  });
}

module.exports = { run };
