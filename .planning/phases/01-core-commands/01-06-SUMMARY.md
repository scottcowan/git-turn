---
phase: 01-core-commands
plan: "06"
subsystem: cli
tags: [git-turn, tests, revert, redo, gc, integration-tests, node-test]

requires:
  - phase: 01-core-commands (plans 01-03, 01-04)
    provides: revert.js, redo.js, gc.js, snapshotWorktree(), restoreSnapshot(), writeOp(), readOps(), listRefs(), deleteRef()

provides:
  - revert.test.js: integration tests for D-01 (HEAD unchanged), D-03 (branch mismatch fail), pre_revert_snapshot_sha in op log
  - redo.test.js: integration tests for D-02 (LIFO redo), nothing-to-redo, double-redo fails (op consumed)
  - gc.test.js: integration tests for D-08/D-09 (session pruning), current-session protection (T-06-02), D-10 hint string

affects: [01-05, wave-3-merge, full-test-suite]

tech-stack:
  added: []
  patterns:
    - "makeTurn helper: write file, git commit, snapshotWorktree(), updateRef(turnRef()), incrementTurn() — manual turn creation for integration tests"
    - "makeSessionRefs with explicit GIT_COMMITTER_DATE per session to guarantee distinct creatordate ordering (avoids gc sort non-determinism)"
    - "process.exit mock via origExit capture/restore for testing commands that exit 1"
    - "console.log capture via origLog pattern for asserting gc D-10 hint output"
    - "Rule 1 fix: snapshotWorktree was passing tree SHA as commit-tree -p parent; corrected to use HEAD commit SHA"

key-files:
  created:
    - src/commands/revert.test.js
    - src/commands/redo.test.js
    - src/commands/gc.test.js
  modified:
    - src/git.js

key-decisions:
  - "snapshotWorktree bug: commit-tree -p parent was indexTree (a tree SHA) not headSha (a commit SHA) — corrected to use headSha(); tree SHAs are invalid as commit parents"
  - "GIT_COMMITTER_DATE injection per session ensures deterministic creatordate ordering when all commits happen within the same second"
  - "gc test uses repoDir passed to makeSessionRefs helper to construct correct HOME+date env vars; makeTestRepo's git helper passes opts.env to override env"

requirements-completed: [D-01, D-02, D-03, D-08, D-09, D-10, D-12]

duration: 15min
completed: "2026-08-09T05:30:00Z"
---

# Phase 01 Plan 06: Revert, Redo, and GC Integration Tests Summary

**Integration tests for revert, redo, and gc using real temp git repos: covers D-01 HEAD-unchanged, D-02 LIFO redo, D-03 branch mismatch, D-08/D-09 session pruning, D-10 hint string, plus auto-fixed snapshotWorktree parent-commit bug**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-09T05:15:00Z
- **Completed:** 2026-08-09T05:30:00Z
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 fixed)

## Accomplishments

- `src/commands/revert.test.js` — 3 tests covering: worktree restore with content assertion, HEAD unchanged after revert (D-01), pre_revert_snapshot_sha present in op log, branch mismatch throws (D-03)
- `src/commands/redo.test.js` — 3 tests covering: revert-then-redo cycle restores v2 content (D-02), nothing-to-redo exits 1, double-redo fails (op consumed)
- `src/commands/gc.test.js` — 5 tests covering: no-op when below keepN threshold, prunes oldest sessions (D-08, D-09), current session never pruned (T-06-02), D-10 hint printed when pruning occurs, no hint when nothing pruned
- Full suite (`node --test`): 12 tests, 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Write revert and redo tests (D-01, D-02, D-03)** — `034c13e` (test + fix)
2. **Task 2: Write gc tests (D-08, D-09, D-10)** — `bec2a84` (test)

## Files Created/Modified

- `src/commands/revert.test.js` — Tests for revert: worktree content restore, HEAD unchanged, branch mismatch, op log
- `src/commands/redo.test.js` — Tests for redo: LIFO restore, nothing-to-redo, double-redo fails
- `src/commands/gc.test.js` — Tests for gc: keepN threshold, age-ordered pruning, current session protection, D-10 hint
- `src/git.js` — Bug fix: `snapshotWorktree` was passing `indexTree` (tree SHA) as `-p` parent to `commit-tree`; fixed to pass `headSha()` (commit SHA)

## Decisions Made

- Explicit `GIT_COMMITTER_DATE` per session in `makeSessionRefs`: when all commits happen in the same sub-second window, `for-each-ref --sort=creatordate` sorts by hash order (non-deterministic). Injecting timestamps at 100-second intervals per session guarantees oldest-first ordering.
- `process.exit` mock pattern (capture/restore origExit, wrap in try/catch): used in redo tests to assert exit code 1 without the test process terminating.
- `console.log` capture pattern (capture/restore origLog, collect to array): used in gc tests to assert D-10 hint string appears/does not appear.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed snapshotWorktree parent commit argument**
- **Found during:** Task 1 — first test run
- **Issue:** `snapshotWorktree()` in `src/git.js` called `commit-tree <worktreeTree> -p <indexTree>` where `indexTree` is a tree SHA (from `git write-tree`). `commit-tree -p` requires a commit SHA, not a tree SHA. All `snapshotWorktree()` calls failed with "not a valid commit object".
- **Fix:** Changed to use `headSha()` as the parent commit SHA. When HEAD exists (not all-zeros), pass `-p headSha()`; otherwise create a root commit without `-p`.
- **Files modified:** `src/git.js`
- **Commit:** `034c13e`

**2. [Rule 1 - Bug] Fixed gc test non-deterministic session ordering**
- **Found during:** Task 2 — gc test 2 ("prunes oldest sessions") failed intermittently
- **Issue:** When multiple sessions are created in rapid succession within the same second, `git for-each-ref --sort=creatordate` produces undefined order (sorts by object hash when dates tie). The test expected idA to always be pruned as "oldest" but the actual oldest was determined by hash order.
- **Fix:** Inject `GIT_COMMITTER_DATE` and `GIT_AUTHOR_DATE` with 100-second offsets per session via `makeSessionRefs` helper parameter `dir`. Each session gets a distinct timestamp guaranteeing oldest-first sort.
- **Files modified:** `src/commands/gc.test.js`
- **Commit:** `bec2a84`

## Known Stubs

None — all test files assert real behavior against real git repos with no hardcoded placeholder values.

## Threat Flags

None — this plan adds only test files. No new network endpoints, auth paths, file access patterns outside temp git repos, or schema changes at trust boundaries.

## Self-Check: PASSED

- `src/commands/revert.test.js` — FOUND
- `src/commands/redo.test.js` — FOUND
- `src/commands/gc.test.js` — FOUND
- Commit `034c13e` — FOUND
- Commit `bec2a84` — FOUND
- `node --test` — 12 tests, 0 failures
