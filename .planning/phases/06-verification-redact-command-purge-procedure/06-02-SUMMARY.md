---
phase: 06-verification-redact-command-purge-procedure
plan: 02
subsystem: testing
tags: [cli, notes, cost-tracking, node-test]

# Dependency graph
requires:
  - phase: 05-record-prompt
    provides: parseSnapshotMessage sha-resolution pattern (used by record-prompt.js) and the note-write path this plan verifies against
provides:
  - cost.js resolves the notes lookup via the real head sha instead of the bare turn-index snapshot sha
  - first-ever end-to-end test coverage for src/commands/cost.js, network-free and HOME-scoped
affects: [06-01, 06-03, 06-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cost.js's per-turn notes lookup now mirrors record-prompt.js: parseSnapshotMessage(sha).headSha resolved before any git notes show call"
    - "async command test harness: captureCostAsync() awaits cost.js's run() while stubbing console.log/console.error/process.stderr.write/process.exit"

key-files:
  created: [src/commands/cost.test.js]
  modified: [src/commands/cost.js]

key-decisions:
  - "Fell back on record-prompt.js/record-prompt.test.js as the sha-resolution and test-scaffolding pattern reference since 06-PATTERNS.md was not present in this worktree (it was untracked in the source repo, not yet committed)"

patterns-established:
  - "cost.test.js overrides process.env.HOME directly in beforeEach/afterEach (in addition to makeTestRepo()'s HOME injection into spawned git child processes) because os.homedir() in the test process itself only respects process.env.HOME, not the git-child-scoped env override"

requirements-completed: [VERIFY-02]

duration: 25min
completed: 2026-09-21
---

# Phase 06 Plan 02: Fix cost.js note-sha resolution Summary

**cost.js now resolves its per-turn notes lookup via `parseSnapshotMessage(sha).headSha` instead of the bare snapshot sha, with new end-to-end test coverage proving a correct $0.0105 total from real captured usage with zero network access.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 1 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments
- Fixed the sha-resolution defect: `cost.js` now looks up `refs/notes/git-turn` by the real HEAD commit sha (resolved via `parseSnapshotMessage`), not the turn-index snapshot sha, matching the pattern already used correctly in `record-prompt.js`
- Added `src/commands/cost.test.js` — the first-ever test file for `cost.js` — with 4 passing tests covering model display, dollar-cost computation, the Total cost summary line, and the empty-session path
- Verified zero network access and zero writes to the developer's real `~/.git-turn-pricing.json` during the test run

## Task Commits

1. **Task 1: Fix cost.js note-sha resolution and create cost.test.js with a network-free pricing fixture** - `9df867b` (fix)

## Files Created/Modified
- `src/commands/cost.js` - added `parseSnapshotMessage` import; per-turn notes lookup now resolves `head = headSha || sha` before calling `gitSafe(['notes', ...])`
- `src/commands/cost.test.js` - new end-to-end test suite: `seedFakePricing()` fixture helper, `seedHookNote()` + `runWithStdin()` (adapted from `record-prompt.test.js`) to drive a real `record-prompt` call, and `captureCostAsync()` to await `cost.js`'s async `run()` while stubbing console/exit

## Decisions Made
- Used `record-prompt.js`/`record-prompt.test.js` as the pattern reference for both the fix and the test scaffolding, since `06-PATTERNS.md` (referenced in the plan's `<context>`) was not present in this worktree — it existed only as an untracked file in the source repository at conversation start and was never committed to the branch this worktree was created from.

## Deviations from Plan

None — plan executed exactly as written. `computeCost()`/`lookupPrice()` required no changes, matching 06-RESEARCH.md Focus Question 2's finding that the defect was isolated entirely to the notes-lookup sha.

## Issues Encountered

The worktree's branch base did not match the expected commit at agent start (merge-base check failed); corrected via `git reset --hard` to the orchestrator-specified base commit per the worktree_branch_check protocol before any file reads or edits began.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- VERIFY-02 is now TRUE: `git turn cost` computes a correct dollar cost from real captured `usage` end-to-end
- Full `npm test` suite green (197 tests, 0 failures) after this change
- No blockers for 06-01, 06-03, or 06-04 — no file overlap with this plan's scope (`src/commands/cost.js`, `src/commands/cost.test.js`)

---
*Phase: 06-verification-redact-command-purge-procedure*
*Completed: 2026-09-21*

## Self-Check: PASSED

- FOUND: src/commands/cost.js
- FOUND: src/commands/cost.test.js
- FOUND: .planning/phases/06-verification-redact-command-purge-procedure/06-02-SUMMARY.md
- FOUND commit: 9df867b (fix: resolve cost.js note-sha lookup and add end-to-end test coverage)
- FOUND commit: 34d51d0 (docs: complete cost.js note-sha fix plan)
