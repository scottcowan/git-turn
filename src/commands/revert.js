'use strict';

const { snapshotWorktree, restoreSnapshot } = require('../git');
const { readSession, listTurns, writeOp } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const N = parseInt(args[0], 10);
  if (isNaN(N)) {
    console.error('Usage: git turn revert <N>');
    process.exit(1);
  }

  const turns = listTurns(session.session_id);
  const turn = turns.find(t => t.turn_n === N);
  if (!turn) {
    console.error('git turn: turn ' + N + ' not found');
    process.exit(1);
  }

  // Pre-revert snapshot MUST happen before any restore so redo has a concrete SHA
  const { commitSha: pre_revert_snapshot_sha } = snapshotWorktree({ message: 'pre-revert snapshot (turn ' + N + ')' });

  // Write revert op BEFORE restoring — if restore throws, the op log record is already written
  writeOp('revert', {
    session_id: session.session_id,
    turn_n: N,
    snapshot_sha: turn.sha,
    pre_revert_snapshot_sha,
    branch: session.branch,
  });

  // Restore worktree to target turn state — throws on branch mismatch (D-03), propagate unhandled
  restoreSnapshot(turn.sha, { branch: session.branch });

  console.log('Reverted to turn ' + N);
}

module.exports = { run };
