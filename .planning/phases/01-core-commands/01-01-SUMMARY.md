---
phase: 01-core-commands
plan: "01"
subsystem: testing
tags: [node-test, git, diff, helpers, test-infrastructure]

requires: []
provides:
  - "node --test compatible test script (no glob)"
  - "makeTestRepo() isolated temp git repo factory with HOME override"
  - "git turn diff command implementing D-04 (two-turn diff) and D-05 (single-turn vs N-1)"
affects: [01-02, 01-03, 01-04, 01-05, 01-06]

tech-stack:
  added: []
  patterns:
    - "makeTestRepo: HOME=dir isolation prevents ~/.gitconfig bleed in all tests"
    - "gitSafe(['diff', shaA, shaB]) array args — no shell interpolation"
    - "EMPTY_TREE constant (4b825dc...) for diffing first turn vs nothing"

key-files:
  created:
    - src/helpers/test-repo.js
    - src/commands/diff.js
  modified:
    - package.json

key-decisions:
  - "node --test without glob: Node 18+ discovers .test.js files recursively without a glob arg"
  - "HOME override in makeTestRepo: prevents gpg signing and developer git config from leaking into test commits"
  - "EMPTY_TREE fallback in diff: first turn has no predecessor, use git's empty tree object"

patterns-established:
  - "Test isolation: makeTestRepo returns { dir, git } — callers rmSync(dir) in afterEach"
  - "Command structure: 'use strict', named run(args) function, module.exports = { run }"
  - "Session guard: readSession() null check + process.exit(1) before any git operations"
  - "Integer validation: parseInt + isNaN guard before using user args as git object refs"

requirements-completed: [D-04, D-05, D-12]

duration: 4min
completed: "2026-08-09"
---

# Phase 01 Plan 01: Fix test script, test-repo helper, and diff command

**node --test glob fix, HOME-isolated makeTestRepo() helper, and read-only `git turn diff` implementing D-04 (N M) and D-05 (N vs N-1) with empty-tree fallback**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-08-09T05:18:00Z
- **Completed:** 2026-08-09T05:19:23Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Fixed broken test script: changed `node --test src/**/*.test.js` to `node --test` so Node 18+ discovers test files recursively without glob errors
- Created `src/helpers/test-repo.js` with `makeTestRepo()` for test isolation — HOME=dir prevents gpg signing and developer gitconfig from leaking into test commits
- Implemented `src/commands/diff.js` with two-arg (D-04) and single-arg (D-05) modes; uses EMPTY_TREE for first turn; all git args are arrays (no shell interpolation)

## Task Commits

1. **Task 1: Fix test script + create test-repo helper (D-12)** - `460315c` (feat)
2. **Task 2: Create diff command (D-04, D-05)** - `ca8afdc` (feat)

## Files Created/Modified

- `package.json` - Test script changed from glob to `node --test`
- `src/helpers/test-repo.js` - `makeTestRepo()` factory returning `{ dir, git }` with HOME isolation
- `src/commands/diff.js` - `git turn diff N [M]` command with session guard, integer validation, and empty-tree fallback

## Decisions Made

- `node --test` without glob args: Node 18+ test runner discovers `*.test.js` recursively — the glob was causing "no matches found" on shells that don't expand it
- HOME=dir in makeTestRepo: ensures test commits use a fresh git config, not the developer's global config (which may have gpg signing enabled)
- EMPTY_TREE as shaA fallback when turn N has no predecessor: same pattern used in show.js

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `makeTestRepo()` is ready for all Wave 3 test plans (01-03 through 01-06)
- `git turn diff` command works end-to-end; bin/git-turn already routes 'diff' to diff.js
- `node --test` now exits 0 with "0 tests" when no test files exist

## Self-Check: PASSED

- `src/helpers/test-repo.js` exists: FOUND
- `src/commands/diff.js` exists: FOUND
- `package.json` test script is "node --test": FOUND
- Task 1 commit 460315c: FOUND
- Task 2 commit ca8afdc: FOUND

---
*Phase: 01-core-commands*
*Completed: 2026-08-09*
