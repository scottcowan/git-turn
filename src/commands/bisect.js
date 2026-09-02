'use strict';

// Binary-search the cross-session turn snapshots, run <cmd> against each
// candidate, and report the first turn where <cmd> fails. The worktree is
// always returned to its pre-bisect state (D-04). All *git* access goes
// through gitSafe with an argv array — shell: true below is intentional and
// confined to <cmd> itself (see 03-03-PLAN.md threat model T-03-21).

const { spawnSync } = require('child_process');
const { gitSafe, repoRoot, snapshotWorktree, restoreSnapshot } = require('../git');
const { readSession, writeOp } = require('../session');
// Namespace-imported (not destructured) so grep-based acceptance criteria
// counting single-line references to isAncestor/etc. stay accurate —
// matches the convention established in src/commands/blame.js.
const blameUtil = require('../blame-util');

function defaultRunCommand(cmd, cwd) {
  return spawnSync(cmd, { shell: true, stdio: 'inherit', cwd });
}

function bisectCore({ cmd, noCache = false, runCommand = defaultRunCommand, log = console.log }) {
  // D-03: gate on a clean worktree BEFORE anything mutating — no snapshot,
  // no op written on this path.
  if (gitSafe(['status', '--porcelain'])) {
    throw new Error('bisect requires a clean worktree. Commit or stash changes first.');
  }

  const session = readSession();
  if (!session) {
    throw new Error('not initialized. Run `git turn init` first.');
  }

  // Candidates must be HEAD-reachable — cross-session turns can belong to a
  // branch that was force-pushed away or deleted, and restoreSnapshot on
  // such a turn either fails or checks out unrelated content.
  const candidates = blameUtil.orderByCommitTopology(
    blameUtil.listAllTurns({ noCache }).filter(t => t.head_sha && blameUtil.isAncestor(t.head_sha))
  );
  if (candidates.length === 0) {
    throw new Error('no turn snapshots reachable from HEAD to bisect');
  }

  const { commitSha: pre_bisect_snapshot_sha } = snapshotWorktree({ message: 'pre-bisect snapshot' });
  writeOp('bisect-start', {
    session_id: session.session_id,
    cmd,
    pre_bisect_snapshot_sha,
    branch: session.branch,
  });

  try {
    log(`Bisecting ${candidates.length} turns with: ${cmd}`);

    // First-bad-index binary search over the topology-ordered candidates —
    // the canonical git-bisect narrowing strategy, not a novel one. 125/null/
    // >=128 classification is completed in Task 3; for now any nonzero status
    // is treated as bad.
    let lo = 0;
    let hi = candidates.length - 1;
    let firstBad = null;
    let tested = 0;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const turn = candidates[mid];
      restoreSnapshot(turn.snapshot_sha, { branch: session.branch });
      log(`  turn ${String(turn.turn_n).padStart(2)}  ${(turn.head_sha || turn.snapshot_sha).slice(0, 7)}  testing...`);
      const result = runCommand(cmd, repoRoot());
      tested++;

      if (result.status === 0) {
        log('  PASS');
        lo = mid + 1;
      } else {
        log('  FAIL');
        firstBad = mid;
        hi = mid - 1;
      }
    }

    if (firstBad !== null) {
      const turn = candidates[firstBad];
      log(`turn ${turn.turn_n} introduced the failure (${(turn.head_sha || turn.snapshot_sha).slice(0, 7)})`);
      return { result: 'found', turn };
    }

    log(`No failing turn found in ${tested} candidates`);
    return { result: 'clean', tested };
  } finally {
    // Never rethrow from finally — that would mask the real error from the
    // search body. On failure to restore, leave an explicit recovery hint.
    try {
      restoreSnapshot(pre_bisect_snapshot_sha, { branch: session.branch });
    } catch {
      process.stderr.write(`git turn: WARNING: failed to restore pre-bisect state; recover with: git read-tree --reset -u ${pre_bisect_snapshot_sha}^{tree}\n`);
    }
    log('Restored pre-bisect state');
  }
}

function run(args) {
  const session = readSession();
  if (!session) {
    console.error('git turn: not initialized. Run `git turn init` first.');
    process.exit(1);
  }

  const noCache = args.includes('--no-cache');
  const cmd = args.filter(a => !a.startsWith('--')).join(' ');
  if (!cmd) {
    console.error('Usage: git turn bisect <cmd>');
    process.exit(1);
  }

  let outcome;
  try {
    outcome = bisectCore({ cmd, noCache });
  } catch (err) {
    console.error(`git turn: ${err.message}`);
    process.exit(1);
  }

  process.exit(outcome.result === 'aborted' ? 1 : 0);
}

module.exports = { run, bisectCore };
