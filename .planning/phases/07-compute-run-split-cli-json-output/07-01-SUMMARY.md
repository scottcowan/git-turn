---
phase: 07-compute-run-split-cli-json-output
plan: 01
subsystem: cli
tags: [diff, rendering, ansi, unified-diff, tdd]

# Dependency graph
requires: []
provides:
  - "src/diff-render.js: pure parseDiff/renderRich/EMPTY_TREE module for DIFF-01"
affects: [07-04 (diff.js/show.js wiring), 07-02, 07-03, 07-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure string-in/string-out renderer module (no console/process access) for MCP-safety"
    - "State-machine hunk-content classification by first character, not prefix-sniffing of raw '---'/'+++' content lines"
    - "Full-row ANSI background highlight via explicit width padding before the background code"

key-files:
  created:
    - src/diff-render.js
    - src/diff-render.test.js
  modified: []

key-decisions:
  - "Followed the plan's corrected behavior spec (not RESEARCH.md's Pattern 3 draft verbatim) — kept the +/-/space marker in colorless rows (D-03), classified hunk content by state machine so raw '---'/'+++' lines count correctly (T-07-02), took width via opts instead of process.stdout.columns, and preserved non-index/---/+++ file metadata lines"
  - "Gutter width computed as the max digit-count across ALL files' newLineNo values (global, not per-file) — matches plan's single-gutter-width-per-render-call intent since the only multi-digit test case (98-101) is single-file; no cross-file conflict surfaced"

patterns-established:
  - "Pure parse/render split: parseDiff() is the single source of truth for both rich-text and future --json added/removed counts (renderRich always calls parseDiff, never re-counts)"

requirements-completed: [DIFF-01]

# Metrics
duration: ~25min
completed: 2026-10-08
---

# Phase 07 Plan 01: Rich Diff Renderer Summary

**Built `src/diff-render.js` — a pure, MCP-safe unified-diff parser and ANSI rich renderer (summary header, new-file line-number gutter, full-row color highlight) that will become `diff`/`show`'s shared default renderer in Plan 07-04.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-10-08T14:34:52Z
- **Tasks:** 2 (RED, GREEN)
- **Files modified:** 2 (both created)

## Accomplishments
- `parseDiff(rawText)` — state-machine unified-diff parser returning `{files, added, removed}`, with raw `---`/`+++`-prefixed hunk *content* lines correctly classified as removal/addition (not swallowed as file-header noise)
- `renderRich(rawText, {color, width})` — summary-first, single new-file gutter, full-row ANSI background highlight when `color:true`, zero ANSI bytes when `color:false`
- `EMPTY_TREE` constant consolidated for reuse by Plan 07-04 (currently duplicated in `diff.js`/`show.js`)
- 12 pure-function unit tests (no repo fixture) covering every behavior case in the plan's `<feature>` block; full suite remains green at 229/229

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Write failing src/diff-render.test.js** - `7274f46` (test)
2. **Task 2 (GREEN): Implement src/diff-render.js** - `1952a35` (feat)

_No refactor commit needed — implementation was green on first pass against all 12 RED tests._

## Files Created/Modified
- `src/diff-render.js` - Pure parser (`parseDiff`) + rich renderer (`renderRich`) + `EMPTY_TREE`, reusing `blame-util.js`'s `parseHunkHeader`
- `src/diff-render.test.js` - 12 `node:test` unit tests, no `makeTestRepo()` fixture (pure string-in/string-out)

## Decisions Made
- Implemented exactly per the plan's `<feature>` behavior block, which explicitly corrects RESEARCH.md's Pattern 3 draft in four ways (marker retained in colorless output, state-machine classification, width via opts not `process.stdout.columns`, non-index metadata preserved) — followed the plan's corrections rather than the research draft.
- Gutter width is computed once per `renderRich()` call across all files' line numbers (not reset per-file), consistent with a single summary header covering the whole diff.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria were met without needing any Rule 1-4 fixes.

## Issues Encountered

None - RED test file failed as expected (module not found) on first run; GREEN implementation passed all 12 tests and the full 229-test suite on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `src/diff-render.js` exports exactly the contract (`parseDiff`, `renderRich`, `EMPTY_TREE`) that Plan 07-04 needs to wire into `diff.js`/`show.js`'s rich (default) and `--json` paths.
- No blockers. Module has zero `console`/`process`/`child_process` access, confirmed via grep gate — safe for later MCP exposure (Phase 8/9).

---
*Phase: 07-compute-run-split-cli-json-output*
*Completed: 2026-10-08*

## Self-Check: PASSED

- FOUND: src/diff-render.js
- FOUND: src/diff-render.test.js
- FOUND: .planning/phases/07-compute-run-split-cli-json-output/07-01-SUMMARY.md
- FOUND: 7274f46 (test commit)
- FOUND: 1952a35 (feat commit)
