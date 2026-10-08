---
phase: 07-compute-run-split-cli-json-output
plan: 04
subsystem: cli
tags: [diff-render, ansi, json, compute-run-split]

# Dependency graph
requires:
  - phase: 07-01
    provides: src/diff-render.js (EMPTY_TREE, parseDiff, renderRich)
provides:
  - diff.js and show.js refactored to export { run, compute }
  - rich diff rendering as default output for `git turn diff`/`git turn show`
  - --plain escape hatch byte-identical to pre-phase output
  - --json structured output for diff/show
affects: [07-05 (MCP tool registration will call diff.js/show.js compute() directly)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "compute(args, opts) / run(args) split: compute() is pure (throws Error, returns one string), run() does all console/process.exit I/O"
    - "Positional-argument filtering: `args.filter(a => a !== '--json' && a !== '--plain')` so flag position never affects turn-number parsing"
    - "Mode precedence inside compute(): --json first (ignores --plain), then --plain (passthrough), else rich default"

key-files:
  created: []
  modified:
    - src/commands/diff.js
    - src/commands/diff.test.js
    - src/commands/show.js
    - src/commands/show.test.js

key-decisions:
  - "Mirrored the exact compute/run contract already shipped in log.js/blame.js (07-02) and cost.js (07-03) for consistency across all 5 refactored command files"
  - "show.js --json added fields (from_sha/to_sha/diff/added/removed) alongside the pre-existing turn metadata fields, rather than nesting diff data under a sub-key, to keep the JSON shape flat and consistent with diff.js's --json shape"

patterns-established:
  - "Rich renderer / --plain / --json triad now established in diff.js and show.js; same shape should be followed by any future command needing a diff output mode"

requirements-completed: [REFACTOR-01, DIFF-01, JSON-01]

# Metrics
duration: 25min
completed: 2026-10-08
---

# Phase 7 Plan 04: diff.js / show.js compute/run split, rich renderer, --json Summary

**diff.js and show.js now export pure `compute()`/`run()`, default to the rich line-numbered renderer from `src/diff-render.js`, keep `--plain` byte-identical to pre-phase output, and add `--json` with raw-diff + parseDiff counts.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-10-08T14:28:00Z
- **Completed:** 2026-10-08T14:53:41Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- `src/commands/diff.js` split into `compute(args, opts)` (pure, throws Error) and `run(args)` (console/process.exit I/O), matching the phase-wide contract
- `src/commands/show.js` split the same way, preserving the `parseSnapshotMessage(turn.sha)` real-HEAD-sha resolution and `--with-prompts` gating verbatim
- Both commands now default to `renderRich()` output (header count line, line-numbered gutter, full-row ANSI backgrounds honoring `shouldColor()`), with `--plain` restoring exact pre-phase passthrough bytes and `--json` emitting structured output with `parseDiff`-derived `added`/`removed` counts
- Appended 18 new tests to `diff.test.js` and 11 new tests to `show.test.js` covering byte-identity, rich rendering under NO_COLOR/FORCE_COLOR, `--json` shape, flag-position independence, `--json`-wins-over-`--plain`, and error paths — all additions, zero lines removed from either pre-existing test file (verified via `git diff 98679b8`)

## Task Commits

Each task was committed atomically:

1. **Task 1: diff.js split + rich default + --plain + --json** - `60c1c24` (feat)
2. **Task 2: show.js split + rich default + --plain + --json** - `879bc34` (feat)

**Plan metadata:** committed separately by the orchestrator after merge (worktree mode)

## Files Created/Modified
- `src/commands/diff.js` - compute()/run() split; EMPTY_TREE now imported from diff-render; rich default, --plain, --json modes
- `src/commands/diff.test.js` - 18 new tests appended (byte-identity, rich render, --json, errors, flag order)
- `src/commands/show.js` - compute()/run() split; EMPTY_TREE now imported from diff-render; rich default, --plain, --json modes; preserved parseSnapshotMessage real-HEAD resolution and --with-prompts gate
- `src/commands/show.test.js` - 11 new tests appended (byte-identity, rich render, --json with/without --with-prompts, errors)

## Decisions Made
- Followed the identical compute/run contract already established by 07-02 (log.js/blame.js) and 07-03 (cost.js) rather than inventing a new shape, for cross-file consistency ahead of Phase 9's MCP tool registration which will call compute() directly across all 5 files.
- show.js's `--json` payload places diff fields (`from_sha`, `to_sha`, `diff`, `added`, `removed`) at the same top level as the turn-metadata fields rather than nesting, matching diff.js's flat shape.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Initial draft of the new test imports in `diff.test.js` replaced the existing `const { run } = require('./diff');` line with a combined `const { run, compute } = require('./diff');` line, which registered as a 1-line deletion against the `98679b8` additions-only baseline and would have failed the plan's verification gate (`grep -cE '^-([^-]|$)'` must be 0). Fixed by leaving the original line untouched and adding a second `const { compute } = require('./diff');` line immediately after it — purely additive, verification now passes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/commands/diff.js` and `src/commands/show.js` now expose `compute()` with the exact phase-wide contract (pure, Error-throwing, no process/console access) that Phase 9's MCP tool registration will call directly for `git_turn_diff`/`git_turn_show`.
- `--json` output shape for both commands is locked in (`from_turn`/`to_turn`/`sha_a`/`sha_b`/`diff`/`added`/`removed` for diff; `turn`/`sha`/`snapshot_sha`/`ts`/`model`/`latency_ms`/`usage`/`tool_summary`/`from_sha`/`to_sha`/`diff`/`added`/`removed`[+`prompt`] for show) — future MCP tool wiring should reuse these shapes rather than inventing new ones.
- No blockers for the remaining Phase 7 waves or for Phase 8 (MCP server scaffold).

---
*Phase: 07-compute-run-split-cli-json-output*
*Completed: 2026-10-08*

## Self-Check: PASSED

- FOUND: src/commands/diff.js
- FOUND: src/commands/show.js
- FOUND: .planning/phases/07-compute-run-split-cli-json-output/07-04-SUMMARY.md
- FOUND: 60c1c24 (Task 1 commit)
- FOUND: 879bc34 (Task 2 commit)
