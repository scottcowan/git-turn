'use strict';

const { restoreSnapshot } = require('../git');
const { readSession, readOps, writeOp } = require('../session');

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const ops = readOps();

  // Build set of revert session_id:turn_n keys that have already been redeemed by a redo op
  const redeemedKeys = new Set(
    ops.filter(op => op.type === 'redo').map(op => op.session_id + ':' + op.revert_turn_n)
  );

  // Find last unredeemed revert op — LIFO via spread+reverse (Pitfall 4)
  const lastRevert = [...ops].reverse().find(
    op => op.type === 'revert' && !redeemedKeys.has(op.session_id + ':' + op.turn_n)
  );

  if (!lastRevert) {
    console.error('git turn: nothing to redo');
    process.exit(1);
  }

  // Restore to the state captured before the revert — let errors propagate
  restoreSnapshot(lastRevert.pre_revert_snapshot_sha, { branch: lastRevert.branch });

  // Mark revert as consumed so double-redo fails correctly (D-02)
  writeOp('redo', {
    session_id: session.session_id,
    revert_turn_n: lastRevert.turn_n,
    restored_snapshot_sha: lastRevert.pre_revert_snapshot_sha,
  });

  console.log('Redo complete (restored state before revert to turn ' + lastRevert.turn_n + ')');
}

module.exports = { run };
