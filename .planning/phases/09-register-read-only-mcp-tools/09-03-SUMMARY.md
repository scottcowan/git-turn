---
phase: 09-register-read-only-mcp-tools
plan: 03
subsystem: mcp
tags: [mcp, zod, git-turn-show, git-turn-diff, adapter-pattern]

# Dependency graph
requires:
  - phase: 09-01
    provides: "opts.color override on show.js/diff.js compute(), tool_summary plain-text rendering in show.js"
provides:
  - "git_turn_show MCP tool adapter (src/mcp/tools/show.js)"
  - "git_turn_diff MCP tool adapter (src/mcp/tools/diff.js)"
affects: [09-04, 09-05, "phase 10 (E2E verification with a real client)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP tool adapter = thin wrapper around compute(argv, opts): reconstruct CLI-flag-shaped argv, call compute() unchanged, try/catch -> isError with verbatim e.message"
    - "show/diff pass { color: false } unconditionally — never read FORCE_COLOR/NO_COLOR/isTTY in the adapter"

key-files:
  created:
    - src/mcp/tools/show.js
    - src/mcp/tools/show.test.js
    - src/mcp/tools/diff.js
    - src/mcp/tools/diff.test.js
  modified: []

key-decisions:
  - "Followed PATTERNS.md templates verbatim for both adapters — no deviation from the worked examples"
  - "show.js z.number().int().positive() for turn (tightened from PATTERNS.md's plain z.number().int(), matching diff.js's and the plan's acceptance intent); toTurn similarly positive().optional()"

patterns-established:
  - "N/A — follows pattern already established by 09-02 (log/blame/cost adapters); no new patterns introduced"

requirements-completed: [MCP-05, MCP-06, MCP-09, MCP-10, VERIFY-03]

# Metrics
duration: 25min
completed: 2026-11-01
---

# Phase 9 Plan 3: git_turn_show and git_turn_diff MCP Tool Adapters Summary

**Thin MCP adapters for `git_turn_show`/`git_turn_diff` that unconditionally force `{ color: false }` on `compute()`, with TDD-covered tests for CLI-text parity, tool_summary round-trip, FORCE_COLOR immunity, and isError paths.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 4 (all new)

## Accomplishments
- `git_turn_show` adapter: camelCase `{ turn, withPrompts }` schema, returns CLI-identical colorless text including `Model:`/`Tool summary:`/prompt body when requested
- `git_turn_diff` adapter: camelCase `{ turn, toTurn }` schema, supports both single-turn (N-1 vs N) and two-turn (N vs toTurn) forms
- Both adapters verified immune to `FORCE_COLOR=1` leaking ANSI into tool output (D-02/MCP-10)
- Both adapters verified to return `isError: true` with the exact thrown message on out-of-range turns and uninitialized repos (MCP-09), never throwing
- VERIFY-03 round-trip tests use real `makeTurn`/`addNote` fixtures, not hand-built shas, confirming the handlers see real hook-shaped notes correctly

## Task Commits

Each task was committed atomically following TDD RED/GREEN:

1. **Task 1: git_turn_show adapter with tests**
   - `a4c0ae4` test(09-03): add failing test for git_turn_show adapter (RED)
   - `d58e521` feat(09-03): implement git_turn_show MCP tool adapter (GREEN)
2. **Task 2: git_turn_diff adapter with tests**
   - `9eb4d43` test(09-03): add failing test for git_turn_diff adapter (RED)
   - `33c8610` feat(09-03): implement git_turn_diff MCP tool adapter (GREEN)

_No refactor commits needed — both adapters matched PATTERNS.md templates on first implementation._

## Files Created/Modified
- `src/mcp/tools/show.js` - `git_turn_show` tool adapter (register + handler), camelCase zod schema, `compute(argv, { color: false })`
- `src/mcp/tools/show.test.js` - 5 tests: success-path parity, VERIFY-03 round-trip, FORCE_COLOR immunity, out-of-range turn, uninitialized repo
- `src/mcp/tools/diff.js` - `git_turn_diff` tool adapter (register + handler), camelCase zod schema with optional `toTurn`
- `src/mcp/tools/diff.test.js` - 8 tests: single-turn parity, two-turn parity, empty-tree diff, VERIFY-03 summary/+/- assertions, FORCE_COLOR immunity (both forms), out-of-range N and M, uninitialized repo

## Decisions Made
- Used `z.number().int().positive()` for `turn`/`toTurn` (PATTERNS.md's worked example used plain `z.number().int()` for `show.js`'s turn) — tightened to match `diff.js`'s stricter schema and the plan's threat-model mitigation (T-09-09: reject non-positive turn numbers before the handler runs). No functional difference observed in tests since all exercised turns are positive integers; this is a stricter superset, not a behavior change.

## Deviations from Plan

None - plan executed exactly as written. Both adapters matched the `09-PATTERNS.md` worked examples verbatim (aside from the int-positive tightening noted above, which is a strictly safer narrowing already implied by the threat model's T-09-09 mitigation, not a new behavior).

## Issues Encountered

`npm test` (full suite including `git turn mcp` server-lifecycle tests) took longer than the default 120s foreground timeout and was moved to background by the tool; confirmed completion with exit code 0 and all suites passing (including the new show/diff adapter tests) via the background task output.

## Next Phase Readiness
- `git_turn_show` and `git_turn_diff` are registered-ready adapters (export `{ register, handler }`) matching the exact shape `src/mcp/server.js` expects to wire in via `register(server)` — this wiring itself is presumably a separate plan/task per the phase's file list (not touched here, per this plan's `files_modified` scope).
- No blockers for the remaining Phase 9 plans (blame/cost adapters landed in 09-02; server.js wiring and any remaining gap work are out of this plan's scope).

---
*Phase: 09-register-read-only-mcp-tools*
*Completed: 2026-11-01*
