# Milestones

## v0.1 Working CLI (Shipped: 2026-08-09)

**Phases completed:** 1 phases, 6 plans, 11 tasks

**Key accomplishments:**

- node --test glob fix, HOME-isolated makeTestRepo() helper, and read-only `git turn diff` implementing D-04 (N M) and D-05 (N vs N-1) with empty-tree fallback
- One-liner:
- Paired revert/redo stateful commands sharing a pre_revert_snapshot_sha op log contract: revert captures current state before restoring turn N, redo finds and restores that captured state via LIFO op search
- gc command prunes stale session turn refs using for-each-ref creatordate ordering, default keep=10, with current-session guard and D-10 hint message
- Three test files covering diff (D-04, D-05), status (D-06, D-07), and init format blob (D-11); all pass with node --test; includes Rule 1 fix to snapshotWorktree in git.js
- Integration tests for revert, redo, and gc using real temp git repos: covers D-01 HEAD-unchanged, D-02 LIFO redo, D-03 branch mismatch, D-08/D-09 session pruning, D-10 hint string, plus auto-fixed snapshotWorktree parent-commit bug

---
