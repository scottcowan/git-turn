---
phase: 01-core-commands
plan: "05"
subsystem: testing
tags: [node-test, diff, status, init, test-suite, D-04, D-05, D-06, D-07, D-11, D-12]

requires: [01-01, 01-02]
provides:
  - "node --test src/commands/diff.test.js: 3 tests covering D-04, D-05"
  - "node --test src/commands/status.test.js: 4 tests covering D-06, D-07"
  - "node --test src/commands/init.test.js: 4 tests covering D-11"
  - "full suite passes: node --test exits 0 with 12 tests"
affects: [src/git.js]

tech-stack:
  added: []
  patterns:
    - "beforeEach chdir / afterEach chdir(origCwd) + rmSync — per-test isolation (Pitfall 7)"
    - "process.exit mock via override-throw-restore pattern for testing exit(1) calls"
    - "console.log capture via override-restore for asserting command output"
    - "manual turn creation: writeFile + git commit + snapshotWorktree + updateRef + incrementTurn"

key-files:
  created:
    - src/commands/diff.test.js
    - src/commands/status.test.js
    - src/commands/init.test.js
  modified:
    - src/git.js

key-decisions:
  - "snapshotWorktree bug fix: indexTree (tree SHA) was passed as -p parent to commit-tree which requires commit SHA — fix creates index commit first then uses it as parent"
  - "Test isolation via session.json removal for uninit test — avoids chdir-outside-beforeEach violation"
  - "Manual turn creation in tests instead of invoking async post-commit hook — simpler, synchronous, no race conditions"

requirements-completed: [D-04, D-05, D-06, D-07, D-11, D-12]

metrics:
  duration: ~8min
  completed: "2026-08-09T05:28:00Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 01 Plan 05: Tests for diff, status, and init commands

**Three test files covering diff (D-04, D-05), status (D-06, D-07), and init format blob (D-11); all pass with node --test; includes Rule 1 fix to snapshotWorktree in git.js**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-08-09T05:20:00Z
- **Completed:** 2026-08-09T05:28:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/commands/diff.test.js` with 3 tests: exit 1 when not initialized, single-turn empty-tree diff, two-turn diff (D-04, D-05)
- Created `src/commands/status.test.js` with 4 tests: session fields output, hook installed/missing/not-from-git-turn (D-06, D-07)
- Created `src/commands/init.test.js` with 4 tests: format blob written to refs/git-turn/format with correct JSON, refs/turns/.format does not exist, session.json created, idempotent (D-11)
- Fixed Rule 1 bug in `src/git.js` snapshotWorktree: indexTree was a tree SHA used as `-p` parent in `git commit-tree`, which requires a commit SHA — now creates an intermediate index commit first

## Task Commits

1. **Task 1: diff and status tests** - `7e411e9` (test + fix)
2. **Task 2: init format blob test** - `3890c4e` (test)

## Files Created/Modified

- `src/commands/diff.test.js` — 3 tests for D-04, D-05; chdir in beforeEach/afterEach only
- `src/commands/status.test.js` — 4 tests for D-06, D-07; three hook states covered
- `src/commands/init.test.js` — 4 tests for D-11; verifies refs/git-turn/format blob JSON fields
- `src/git.js` — fixed snapshotWorktree: indexTree (tree SHA) → create index commit → use commit SHA as -p parent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed snapshotWorktree passing tree SHA as -p parent**
- **Found during:** Task 1 — first diff test run
- **Issue:** `snapshotWorktree()` passed `indexTree` (a tree SHA from `git write-tree`) as a `-p` parent argument to `git commit-tree`. The `-p` flag requires a commit SHA, causing `fatal: <sha> is not a valid 'commit' object`
- **Fix:** Added an intermediate `git commit-tree indexTree` call to create a dangling index commit, then pass that commit's SHA as `-p` to the snapshot commit
- **Files modified:** `src/git.js`
- **Commit:** `7e411e9`

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. All test files operate only on isolated temp git repos. HOME is overridden to the temp dir in all git calls (via makeTestRepo) preventing config bleed (T-05-01). All temp dirs cleaned up in afterEach (T-05-02).

## Self-Check

- `src/commands/diff.test.js` exists: FOUND
- `src/commands/status.test.js` exists: FOUND
- `src/commands/init.test.js` exists: FOUND
- `src/git.js` modified (snapshotWorktree fix): FOUND
- Task 1 commit 7e411e9: to be verified
- Task 2 commit 3890c4e: to be verified
- `node --test` exits 0 with 12 tests passing: VERIFIED

## Self-Check: PASSED
