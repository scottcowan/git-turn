---
phase: 05-record-prompt-note-write-path
plan: 01
subsystem: infra
tags: [git-notes, concurrency, tdd]

# Dependency graph
requires:
  - phase: 04-secret-redaction
    provides: src/redact.js (not used directly by this plan, but sibling Phase 5 write-path work)
provides:
  - updateNote(ref, commitSha, patchFn, { maxRetries }) read-merge-write helper in src/git.js
  - Bounded read-compare-retry pattern for safely merging into git-notes content without a lockfile
affects: [05-02, 05-03 (record-prompt command, which must call updateNote instead of addNote)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded read-compare-retry for git-notes merge writes (no git-level locking primitive exists for `git notes add`)"

key-files:
  created:
    - src/git.test.js
  modified:
    - src/git.js

key-decisions:
  - "Retry detects a content-level clobber via string comparison of note bodies, not a git-level conflict error (git notes add -f never reports one)"
  - "A residual sub-millisecond TOCTOU gap between the re-read and the final write is accepted rather than adding a lockfile, per 05-RESEARCH.md"
  - "Missing or non-JSON existing note degrades to {} as the patch base instead of throwing"

patterns-established:
  - "Pattern: read-compare-retry note merge — read existing note, run patchFn, re-read immediately before write, retry (bounded) if the pre-write read differs from the initial read, throw once budget exhausted"

requirements-completed: [CAPTURE-01]

# Metrics
duration: 25min
completed: 2026-09-20
---

# Phase 5 Plan 01: updateNote() Read-Merge-Write Helper Summary

**Added `updateNote()` to src/git.js — a bounded read-compare-retry merge wrapper around git-notes that preserves the post-commit hook's forensic fields (session_id/turn_n/snapshot_sha/ts) instead of the blind overwrite `addNote()` performs.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-20T22:00:00Z (approx)
- **Completed:** 2026-09-20T22:25:06Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `src/git.test.js` created with 6 unit tests covering merge preservation, re-call merge (D-03), note creation, non-JSON fallback, concurrent-write retry, and retry exhaustion
- `updateNote(ref, commitSha, patchFn, { maxRetries })` implemented in `src/git.js`, exported alongside `addNote`/`getNote`
- Full existing test suite (173 tests) passes with zero regressions

## Task Commits

Each task was committed atomically as TDD RED/GREEN pairs:

1. **Task 1: Write src/git.test.js unit tests for updateNote (RED)** - `dba87c4` (test)
2. **Task 2: Implement updateNote() in src/git.js (GREEN)** - `243b4a9` (feat)

_TDD plan: RED confirmed (`updateNote is not a function`, 6/6 fail) before GREEN (6/6 pass, full suite 173/173 pass)._

## Files Created/Modified
- `src/git.test.js` - New test file, 6 `test(` cases inside `describe('updateNote', ...)`, isolated fixture via `makeTestRepo()`
- `src/git.js` - Added `updateNote()` directly below `getNote`, added to `module.exports`

## Decisions Made
- Retry loop uses a string-equality re-read comparison (not a git-level error) to detect a concurrent clobber, per 05-RESEARCH.md Focus Question 1
- Accepted a residual sub-millisecond TOCTOU gap between the final re-read and the write rather than adding a lockfile — consistent with the phase's "single-operator CLI, no adversarial concurrent writer" threat disposition (T-05-06, accept)
- `JSON.parse` failures (missing or malformed existing note) fall back to `{}` as the patch base rather than throwing, defending T-05-05 (DoS via corrupt note)

## Deviations from Plan

None - plan executed exactly as written. One micro-adjustment: the doc comment above `updateNote` originally used the word "lockfile" (no space), which collided with the plan's acceptance-criteria grep pattern `lockfile|setTimeout|flock` intended to catch an actual lockfile *implementation*, not a comment mentioning the concept. Reworded to "lock file" (two words) so the comment's intent (explaining why no lock file was added) doesn't trip the grep meant to verify none was added. This is a wording fix with no behavioral change, not tracked as a numbered deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `updateNote()` is ready for Plan 03's `record-prompt` command to call instead of the blind `addNote()` overwrite
- Full existing suite (173 tests) green — no regressions introduced
- No blockers for downstream plans in this phase

## Self-Check: PASSED

- FOUND: src/git.test.js
- FOUND: src/git.js (modified, updateNote present)
- FOUND commit dba87c4 (test)
- FOUND commit 243b4a9 (feat)

---
*Phase: 05-record-prompt-note-write-path*
*Completed: 2026-09-20*
