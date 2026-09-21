---
phase: 06-verification-redact-command-purge-procedure
plan: 03
subsystem: cli
tags: [git-notes, redaction, secret-handling, cli-command]

# Dependency graph
requires:
  - phase: 05-record-prompt
    provides: updateNote() read-merge-write helper, parseSnapshotMessage() headSha resolution, SQLite cache updatePromptFields()
provides:
  - "git turn redact <N> command — post-hoc scrub of a turn's captured prompt field"
  - "bin/git-turn registration and help text for redact"
affects: [06-04-purge-procedure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Post-hoc note remediation via updateNote() spread-merge, mirroring record-prompt.js's write pattern"
    - "No-op guard before note write to avoid needlessly growing the linear refs/notes/git-turn chain"

key-files:
  created:
    - src/commands/redact.js
    - src/commands/redact.test.js
  modified:
    - bin/git-turn

key-decisions:
  - "Only the freeform prompt field is scrubbed (D-01) — model/usage/latency_ms/tool_summary are structured/enumerable and preserved"
  - "No confirmation prompt (D-02), matching revert/redo's immediate-execution convention"
  - "Session-scoped turn lookup only (matches show.js/diff.js) — no cross-session lookup added in this phase"
  - "Redact prints an explicit pointer to `git turn gc --purge-notes` since the old blob remains in the object store until purge runs"

patterns-established:
  - "redact.js: no-op guard reads the note first and skips the write entirely when prompt is already absent, avoiding needless notes-history growth"

requirements-completed: [REDACT-02]

duration: 12min
completed: 2026-09-21
---

# Phase 6 Plan 3: git turn redact Command Summary

**`git turn redact <N>` scrubs a turn's captured prompt field to `[REDACTED]` via merge-write on the correctly-resolved head sha, leaving every other note field byte-identical and syncing the SQLite read cache.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- New `src/commands/redact.js` implementing the full remediation flow: session guard, arg validation, session-scoped turn lookup, `parseSnapshotMessage()`-based headSha resolution, no-op guard, `updateNote()` spread-merge write, best-effort cache sync, and a pointer to the purge command
- New `src/commands/redact.test.js` with 5 tests covering field preservation, the no-op path, both error paths (bad turn number, non-numeric arg), and cache sync
- `bin/git-turn` registration (`COMMANDS` array) and help text (`redact <N>`) — no dispatcher changes needed since the generic `src/commands/<cmd>.js` resolution already handles it

## Task Commits

1. **Task 1: Create src/commands/redact.js and register it in bin/git-turn** - `d700733` (feat)
2. **Task 2: Create src/commands/redact.test.js** - `e082b60` (test)

## Files Created/Modified
- `src/commands/redact.js` - post-hoc prompt scrub command, exports `run(args)`
- `src/commands/redact.test.js` - 5 tests covering REDACT-02 behavior
- `bin/git-turn` - added `'redact'` to `COMMANDS`, added help text line

## Decisions Made
None beyond what the plan specified — implementation followed the plan's step-by-step action block exactly, copying the turn-resolution convention from `show.js` and the merge-write/cache-sync pattern from `record-prompt.js`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Initial Task 2 commit was accidentally run with `--no-verify`, skipping pre-commit hooks. Caught before proceeding: reset with `git reset --soft HEAD~1` (undoing only that commit, keeping the staged changes) and recommitted normally with hooks enabled. Final commit `e082b60` ran hooks successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `redact.js`'s note-mutation pattern (headSha resolution + spread-merge write + best-effort cache sync) is directly reusable groundwork for plan 06-04's purge procedure, which must operate on the same `refs/notes/git-turn` history this plan scrubs field-values from.
- Redaction alone does not remove the old blob from the object store — this plan explicitly surfaces that gap to the user via the `git turn gc --purge-notes` pointer printed after every successful redact, so 06-04 has a clear, already-referenced command name to implement against.
- No blockers.

---
*Phase: 06-verification-redact-command-purge-procedure*
*Completed: 2026-09-21*
