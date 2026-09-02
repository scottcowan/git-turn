---
phase: 03-bisect-blame
plan: 03
subsystem: cli
tags: [git, bisect, binary-search, child_process, signal-handling]

# Dependency graph
requires:
  - phase: 03-bisect-blame
    provides: "src/blame-util.js's listAllTurns/isAncestor/orderByCommitTopology (Plan 03-01) for cross-session candidate enumeration and ordering"
provides:
  - "git turn bisect <cmd> — binary-searches cross-session turn snapshots, runs <cmd> against each candidate, reports the first failing turn"
  - "bisectCore(options) — throw-based (not process.exit) core exported alongside run for unit testing every failure path"
affects: [03-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-bad-index binary search over topology-ordered candidates (git-bisect narrowing), not linear scan"
    - "Guarded restore factored into one module-local function (restorePreBisectState) shared by finally and both signal handlers, so the recovery-hint string cannot drift"
    - "Named SIGINT/SIGTERM handlers registered after the pre-mutation snapshot and removed in finally, so repeated in-process invocations (test suite) never leak listeners"
    - "git bisect run exit-code convention: 0 good, 125 skip, null/>=128 abort, else bad"

key-files:
  created:
    - src/commands/bisect.js
    - src/commands/bisect.test.js
  modified: []

key-decisions:
  - "Namespace-imported blame-util (const blameUtil = require('../blame-util')) instead of destructuring, matching the convention blame.js already established, so grep-based acceptance criteria counting single-line references to isAncestor stay accurate (destructuring put isAncestor on both the import line and the usage line, doubling the match count)."
  - "bisectCore emits its own verdict line (found/clean/all-skipped/aborted) immediately before the finally's Restored pre-bisect state line, so run() adds no extra output on success — the ordering constraint that Restored pre-bisect state must be the last line is satisfied without run() needing to intercept bisectCore's log stream."
  - "On exit 125 (untestable), the search advances lo = mid + 1 rather than treating the candidate as neither good nor bad and re-probing — documented inline as a deliberate simplification that can mis-locate the boundary when a run of candidates is untestable, matching the plan's explicit instruction not to invent a new narrowing strategy."

requirements-completed: [D-03, D-04, D-05]

# Metrics
duration: 20min
completed: 2026-09-02
---

# Phase 3 Plan 3: `git turn bisect` command Summary

**`git turn bisect <cmd>` binary-searches cross-session turn snapshots with a first-bad-index search, live per-candidate PASS/FAIL/SKIP progress, `git bisect run` exit-code semantics (0/125/128+/null), and a guaranteed worktree restore on every exit path including SIGINT/SIGTERM.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-02T15:49:00Z
- **Completed:** 2026-09-02T16:09:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `bisectCore` gates on a clean worktree (D-03) before taking any snapshot or writing any op, enumerates only HEAD-reachable cross-session candidates via `isAncestor` + `orderByCommitTopology`, and guarantees the pre-bisect state is restored on every exit path — clean, found, all-skipped, aborted, and a thrown `runCommand` error — via `finally` plus SIGINT/SIGTERM handlers (D-04).
- Binary search (not linear scan) narrows candidates in O(log n) checkouts, printing the `Bisecting N turns with: <cmd>` header, per-candidate `testing...`/`PASS`/`FAIL`/`SKIP` progress, and a final verdict line naming the failing turn (D-05).
- Full `git bisect run` exit-code classification: `0` good, `125` untestable/skip (advances past it), `null`/`>=128` aborts the search immediately, any other nonzero is bad.
- `bisect-start` and `bisect-end` audit entries land in the op log; `bisect-end` carries the result string and (on the `found` path) the failing turn number.
- Manually verified end-to-end against a real repo: `git turn bisect "grep -q v2 work.txt"` correctly identified the turn where the searched-for content regressed, printed the full progress/verdict output, and left the worktree exactly as it was.

## Task Commits

Each task was committed atomically:

1. **Task 1: Clean-worktree gate, candidate enumeration, pre-bisect snapshot and guaranteed restore** - `cb50ed4` (feat)
2. **Task 2: Binary search with live progress and final verdict** - `0dfbc6b` (feat)
3. **Task 3: Exit-code classification, signal-safe restore, and bisect-end op logging** - `98dd0c8` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/commands/bisect.js` - `bisectCore`/`run`: clean-worktree gate, HEAD-reachable candidate enumeration, binary search, exit-code classification, signal-safe guaranteed restore, `bisect-start`/`bisect-end` op logging
- `src/commands/bisect.test.js` - 21 unit tests covering D-03, D-04 (three restore paths), D-05 output, the 7-candidate binary search, the boundary case where the oldest candidate already fails, all four exit-code classes, the op log, and the SIGINT listener-count invariant

## Decisions Made
- Namespace-imported `blame-util` (matching `blame.js`'s established pattern) rather than destructuring, to keep grep-based single-line acceptance checks (`isAncestor` count == 1) accurate.
- Factored the guarded pre-bisect restore into one `restorePreBisectState` helper shared by the `finally` block and both signal handlers, so the stderr recovery-hint string (`git read-tree --reset -u <sha>^{tree}`) cannot drift between the three call sites.
- Kept the exit-125 "skip" handling as a simple lo-advance rather than a distinct skip-branch of the binary search tree, per the plan's explicit "Don't Hand-Roll" instruction to stay with the canonical git-bisect narrowing strategy; the tradeoff (mis-locating the boundary when a run of candidates is untestable) is documented inline in `bisect.js`.

## Deviations from Plan

None - plan executed exactly as written. The one adjustment (namespace-importing `blame-util`) was already anticipated by the plan's own interface conventions (mirroring `blame.js`) and is recorded above as a decision, not a deviation, since it changes no behavior — only how the module is required.

## Issues Encountered
- Two of the new tests initially failed nondeterministically because `orderByCommitTopology`'s `git rev-list --topo-order --reverse --no-walk` ordering is only deterministic across commits with distinct (second-resolution) commit timestamps — the same test-fixture-only issue documented in `03-01-SUMMARY.md`. Fixed by adding a `tick()` helper (a ~1.1s real sleep) between fixture-created turns in the two tests that assert a *specific* `turn_n` rather than just result shape (the 7-candidate binary-search test and the "oldest candidate already fails" boundary test). No production code was affected — `bisectCore` itself is unchanged by this fix.
- One test (`binary-searches 7 candidates...`) initially failed with `git commit` erroring "nothing to commit" because the fixture wrote the identical content (`'ok'`) across three consecutive turns; changed to unique per-turn content (`'ok-1'`, `'ok-2'`, ...) so each `makeTurn` call actually produces a new commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `git turn bisect <cmd>` is complete and manually verified end-to-end; `bin/git-turn bisect` no longer reaches the "not yet implemented" error path.
- Roadmap success criteria 2 (bisect) and half of criterion 3 (cache-first candidate enumeration, shared with `blame`) are satisfied.
- The residual SIGKILL / detached-child restore gap is documented in code comments and the plan's threat model (T-03-23) rather than papered over — a hard kill of the process, or a `<cmd>` that reparents a child, can still leave a candidate tree checked out. This is an accepted, documented risk, not a blocker.
- No blockers for Plan 03-04 (README/AGENTS.md documentation of the `shell: true` trust boundary for `<cmd>`, per T-03-21's mitigation plan).

---
*Phase: 03-bisect-blame*
*Completed: 2026-09-02*

## Self-Check: PASSED

All created files and task commit hashes verified present (see below).
