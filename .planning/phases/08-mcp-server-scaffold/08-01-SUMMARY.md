---
phase: 08-mcp-server-scaffold
plan: 01
subsystem: cli
tags: [cost, blame-util, cross-session, tdd]

requires:
  - phase: 07-compute-run-split
    provides: "cost.js's pure async compute(args, opts) with --json support"
provides:
  - "`git turn cost --all` aggregates usage/cost across every session via listAllTurns({ noCache })"
  - "renderSession() helper shared by the single-session and --all rendering paths"
affects: [09-mcp-tool-registration]

tech-stack:
  added: []
  patterns:
    - "Cross-session CLI aggregation: group listAllTurns() results by session_id, render each group with a shared per-session helper, then fold per-session totals into a grand total"

key-files:
  created: []
  modified:
    - src/commands/cost.js
    - src/commands/cost.test.js

key-decisions:
  - "Extracted renderSession(sessionId, entries, pricing, wantJson) rather than duplicating the per-session rendering loop for --all, so the single-session path and each --all block share one code path"
  - "--all plain text separates session blocks with a blank line and appends one trailing 'Grand total across N sessions (.../... turns): $X.XXXX' line, matching D-04"
  - "--all JSON keeps top-level session_id as the current session's id (Phase 7 shape unchanged) while each turn carries its own session_id"

patterns-established:
  - "Pattern: shared renderSession() helper for per-session CLI output blocks, reused by both scoped (current-session) and --all (cross-session) callers"

requirements-completed: [COST-01]

duration: 50min
completed: 2026-10-21
---

# Phase 8 Plan 1: cost --all cross-session fix Summary

**`git turn cost --all` now reports real per-session blocks plus a grand total across every session, via the existing `listAllTurns({ noCache })` cross-session helper — fixing a previously silent no-op flag.**

## Performance

- **Duration:** 50 min
- **Started:** 2026-10-21T16:35:00Z
- **Completed:** 2026-10-21T17:25:39Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `cost --all` (plain text and `--json`) now spans every session in the repo instead of silently reporting only the current session
- Per-session rendering logic deduplicated into `renderSession()`, used identically by the single-session path and each `--all` session block
- Single-session output (no `--all`) remains byte-identical to before — verified by all pre-existing `cost.test.js` cases passing unchanged

## Task Commits

1. **Task 1: Add failing --all test cases to cost.test.js** - `02ee161` (test)
2. **Task 2: Implement the --all branch in cost.js compute()** - `f329f16` (feat)

## Files Created/Modified
- `src/commands/cost.js` - Added `renderSession()` helper; `compute()` gained an `--all` branch that groups `listAllTurns({ noCache })` results by `session_id`, renders each group, and appends a grand-total line; single-session path now builds `entries` and calls the same helper
- `src/commands/cost.test.js` - Added a `describe('cost --all (COST-01)', ...)` block with 4 tests (plain-text multi-session, `--json` multi-session, no-`--all` regression guard, `--no-cache` ref-walk fallback)

## Decisions Made
- Followed the plan's prescribed refactor shape (extract `renderSession`, group by `session_id` in `listAllTurns()`'s first-appearance/ts order, sum per-session totals into a grand total) with no deviation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Test fixture helper (`seedTurnWithUsage`) initially reused a constant file content (`'x'`) across multiple turns in the same session, which produced an empty, failing `git commit` on the second call (no changes to commit). Fixed by making the written content vary per turn (`JSON.stringify({ model, usage, turn })`) so each `makeTurn()` call has real changes to commit. This was test-fixture plumbing, not a cost.js behavior change, so no deviation entry was warranted.

## Next Phase Readiness
- COST-01 is complete; `git turn cost --all` behavior now matches AGENTS.md's documented contract and is ready for Phase 9's `git_turn_cost` MCP tool to mirror.
- No blockers for Phase 8's remaining plans (MCP server scaffold itself).

---
*Phase: 08-mcp-server-scaffold*
*Completed: 2026-10-21*
