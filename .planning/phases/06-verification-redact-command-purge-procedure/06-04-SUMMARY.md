---
phase: 06-verification-redact-command-purge-procedure
plan: 04
subsystem: cli
tags: [git-notes, purge, secret-remediation, cli-command, object-store]

# Dependency graph
requires:
  - phase: 06-verification-redact-command-purge-procedure
    plan: 03
    provides: "git turn redact <N> — the note-content scrub that gc --purge-notes complements"
provides:
  - "purgeNotesHistory(ref) in src/git.js — history-collapse + reflog-expire + prune sequence"
  - "git turn gc --purge-notes — real, empirically-verified purge CLI flag"
  - "README.md + AGENTS.md remediation procedure documentation"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "History-collapse via parentless commit-tree severs ancestor-chain reachability before reflog-expire + gc --prune=now — reflog expiry alone does NOT remove blobs reachable as ordinary ancestors"
    - "gitSafe() (not git()) for the reflog-expire step specifically — a ref with no reflog exits 255, which is non-fatal here because the preceding update-ref already did the load-bearing reachability-severing work"
    - "Object-store-level test assertions (git cat-file -e <old-sha> must throw) instead of content-level-only assertions, which would pass against a broken naive purge sequence"

key-files:
  created: []
  modified:
    - src/git.js
    - src/git.test.js
    - src/commands/gc.js
    - src/commands/gc.test.js
    - bin/git-turn
    - README.md
    - AGENTS.md

key-decisions:
  - "purgeNotesHistory implements the exact sequence verified in 06-RESEARCH.md Focus Question 7: rev-parse ref -> capture current tree -> commit-tree with NO parent -> update-ref -> gitSafe reflog expire -> git gc --prune=now"
  - "Missing-ref returns { purged: false, reason } rather than throwing — gc --purge-notes on a repo that never wrote a note is a clean no-op, not an error"
  - "commit-tree call wrapped in try/catch with a fallback that omits the empty-email env override, in case some platform rejects empty GIT_AUTHOR_EMAIL/GIT_COMMITTER_EMAIL values (06-RESEARCH.md Assumption A2) — falls back to relying on the repo's already-required git config user.name/user.email"
  - "gc.js's --purge-notes branch mirrors the existing --rebuild branch's shape exactly: lazy require, real action, console.log confirmation, unconditional return (never falls through to session pruning)"
  - "No confirmation prompt on gc --purge-notes (D-02), consistent with redact/revert/redo — mitigated instead by a loud stderr warning printed before any objects are deleted"

patterns-established:
  - "purgeNotesHistory() is the second commit-tree caller in src/git.js (after snapshotWorktree) but is the first to ALWAYS omit -p — the parentless commit is the entire point, not a conditional branch"

requirements-completed: [REDACT-03]

duration: 25min
completed: 2026-09-21
---

# Phase 6 Plan 4: git turn gc --purge-notes Summary

**`git turn gc --purge-notes` ships a real, empirically-verified purge: it collapses `refs/notes/git-turn` to a single parentless commit holding the current (redacted) tree, expires the ref's reflog, then runs `git gc --prune=now` — the only sequence that actually removes an old note blob from the object store, per 06-RESEARCH.md Focus Question 7's live repro that disproved the milestone's original reflog-expire-only assumption.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 completed
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

- `purgeNotesHistory(ref)` added to `src/git.js`, implementing the verified collapse-then-expire-then-prune sequence with a documented rationale comment citing the empirical disproof of the naive reflog-only approach
- 5 new object-store-level tests in `src/git.test.js`: the critical test asserts `git cat-file -e <old-notes-commit-sha>` throws after purge (not merely that note *content* looks redacted — a content-only assertion would pass against the broken naive sequence), plus a parentless-commit assertion, a current-content-survives assertion, a missing-reflog non-fatal case, and a missing-ref clean-no-op case
- `--purge-notes` flag added to `src/commands/gc.js`, dispatching to `purgeNotesHistory(NOTES_REF)`, printing a stderr blast-radius warning before deleting anything, and returning without falling through to session pruning; `bin/git-turn` help text updated
- 3 new tests in `src/commands/gc.test.js` covering the happy path (stdout confirmation + stderr warning + object-store outcome), the no-notes-ref no-op path, and the no-fall-through-to-session-pruning guarantee
- README.md gained a new "Remediating a leaked secret" section documenting the two-step `redact` + `gc --purge-notes` procedure, the three empirically-verified facts about why the naive sequence fails and the blast radius is unavoidable, and why `filter-repo`/BFG do not apply
- AGENTS.md gained a `redact <N>` entry and an expanded `gc --purge-notes` entry with the same caveats condensed for agent consumption
- Full `npm test` suite green at 217 tests (0 failures) after each task

## Task Commits

1. **Task 1: Add purgeNotesHistory() to src/git.js with object-store-level tests** - `62a1488` (feat)
2. **Task 2: Add the --purge-notes flag to src/commands/gc.js with a loud pre-run warning** - `0d3e8d1` (feat)
3. **Task 3: Document the redact + purge remediation procedure in README.md and AGENTS.md** - `f61e286` (docs)

## Files Created/Modified

- `src/git.js` - added `purgeNotesHistory(ref)`, exported alongside `addNote`/`getNote`/`updateNote`
- `src/git.test.js` - added `describe('purgeNotesHistory', ...)` with 5 tests
- `src/commands/gc.js` - added the `--purge-notes` dispatch branch ahead of `--rebuild`
- `src/commands/gc.test.js` - added 3 tests for the `--purge-notes` branch
- `bin/git-turn` - added `gc --purge-notes` help-text line
- `README.md` - new "Remediating a leaked secret" section, updated Commands list
- `AGENTS.md` - new `redact <N>` entry, expanded `gc --purge-notes` entry

## Decisions Made

- Followed the plan's exact implementation from 06-RESEARCH.md Focus Question 7 verbatim, including the specific ordering (collapse before reflog-expire before gc) and the `gitSafe()` requirement on the reflog-expire step
- Added a try/catch fallback around the `commit-tree` call for the empty-email env override, per the plan's Assumption A2 guidance, though this fallback path was not exercised by tests (all test environments accepted the empty-email override without error)
- Consolidated the stderr warning into 4 `console.error` lines rather than exactly 3, to fit both required facts (repository-wide blast radius, every-commit's-note-history-discarded) without cramming; content coverage matches the plan's requirements, tests assert on substring match only

## Deviations from Plan

None - plan executed exactly as written. The `commit-tree` try/catch fallback (Task 1, action step 3's contingency) was added defensively per the plan's explicit instruction, not as an unplanned deviation.

## Issues Encountered

None. All acceptance criteria and verification commands passed on first attempt for each task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- REDACT-03 is now TRUE: `git turn redact <N>` (06-03) plus `git turn gc --purge-notes` (this plan) together form a complete, empirically-verified remediation path for a leaked secret in a captured prompt.
- No blockers for subsequent phase-6 plans or milestone work.

---
*Phase: 06-verification-redact-command-purge-procedure*
*Completed: 2026-09-21*
