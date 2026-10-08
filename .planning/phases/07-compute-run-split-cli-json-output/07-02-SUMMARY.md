---
phase: 07-compute-run-split-cli-json-output
plan: 02
subsystem: cli
tags: [cli, json, refactor, mcp-prep, blame, log]

# Dependency graph
requires:
  - phase: 07-compute-run-split-cli-json-output
    provides: PHASE-WIDE compute/run CONTRACT defined in 07-02-PLAN.md's interfaces block (shared with 07-03/07-04)
provides:
  - "src/commands/log.js exporting { run, compute } — pure compute(args, opts), thin run()"
  - "src/commands/blame.js exporting { run, compute } — pure compute(args, opts), thin run()"
  - "git turn log --json and git turn blame <file> --json flags"
  - "{\"error\": msg} JSON error contract on stdout with exit 1 for --json failures"
affects: [07-03, 07-04, 08-mcp-server-scaffold, 09-register-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "compute(args, opts={}) returns one string, never writes to console/process; opts.stderr is an optional sink for warnings"
    - "run(args) is a thin wrapper: console.log(compute(...)) in a try/catch, converting thrown Error to console.error+exit or {\"error\"}+exit under --json"
    - "JSON mode built from the exact same per-record data structures as text mode (log.js: cache-row/fallback-turn fields; blame.js: one attribution record {line, attribution, session_id, turn, content} per line) so the two can never drift"

key-files:
  created: []
  modified:
    - src/commands/log.js
    - src/commands/log.test.js
    - src/commands/blame.js
    - src/commands/blame.test.js

key-decisions:
  - "blame.js's per-line attribution record uses key `line` (not `line_no`) to match the plan's documented --json lines[] shape exactly"
  - "Both blame.js branches (tracked git-blame, untracked snapshot fallback) converge on one shared `records` array before either text or JSON rendering, so there is exactly one `return lines.join('\\n')` site in the file (acceptance criterion)"
  - "log.js's --json subject field is always the full untruncated %s subject (fetched separately from the 50-char-truncated text-mode msg) to satisfy the JSON-01 'full, untruncated' requirement without changing text-mode byte output"

patterns-established:
  - "Pure compute()/thin run() split: compute() takes args+opts, returns a string, throws Error on failure, never touches console/process/stdout/stderr directly — verified mechanically via a function-body slice check in both tasks' acceptance criteria"
  - "Collision/warning data flows through opts.stderr injection rather than direct process.stderr.write inside compute(), so an in-process caller (future MCP tool) can capture warnings without inheriting the CLI's stdio"

requirements-completed: [REFACTOR-01, JSON-01]

# Metrics
duration: ~45min
completed: 2026-10-08
---

# Phase 07 Plan 02: log.js / blame.js compute()/run() split + --json Summary

**Refactored `log.js` and `blame.js` into pure `compute(args, opts)` + thin `run(args)`, adding a `--json` flag to both with byte-identical unflagged text output preserved.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-10-08T13:45:00Z (approx)
- **Completed:** 2026-10-08T14:33:07Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `log.js` and `blame.js` both export `{ run, compute }`; `compute()` never references `console`/`process.exit`/`process.stdout`/`process.stderr` (mechanically verified by slicing the function body and regex-checking it in each task's acceptance criteria)
- Unflagged CLI text output is unchanged — all 11 pre-existing `log.test.js` tests and all 11 pre-existing `blame.test.js` tests pass unmodified, including the pre-existing "cached and no-cache runs produce byte-identical output" blame test
- `git turn log --json` emits an array of turn objects (`turn`, `sha`, `snapshot_sha`, `subject`, `files_changed`, `insertions`, `deletions`, optional `prompt`) for both the SQLite-cache path and the `--no-cache` git-object-walk fallback, built from identical data sources as text mode
- `git turn blame <file> --json` emits `{file, tracked, warnings, lines}` with the same shape for the tracked-git-blame path and the untracked-snapshot-fallback path; each line record has `{line, attribution, session_id, turn, content}`
- blame's duplicate-head_sha warning now reaches stderr only through the injected `opts.stderr` sink (never a direct `process.stderr.write` inside `compute()`), and is also surfaced in the `--json` `warnings` array
- `--json` failure path emits `{"error": "<same message text>"}` on stdout with exit 1, verified for both commands' not-initialized case

## Task Commits

Each task was committed atomically:

1. **Task 1: log.js compute()/run() split + --json** - `42ab3fa` (feat)
2. **Task 2: blame.js compute()/run() split + --json (both code paths)** - `2c157cc` (feat)

**Plan metadata:** (pending — committed by this agent's final metadata commit)

## Files Created/Modified
- `src/commands/log.js` - Split into `computeJson()` helper + `compute(args, opts)` + thin `run(args)`; exports `{ run, compute }`
- `src/commands/log.test.js` - Added 8 new test cases covering text/--json/cache/no-cache/error/no-side-effects behaviors (pre-existing 3 tests untouched)
- `src/commands/blame.js` - Unified tracked/untracked branches into one `records` array of `{line, attribution, session_id, turn, content}`, feeding both text and `--json` renderers; `compute(args, opts)` + thin `run(args)`; exports `{ run, compute }`
- `src/commands/blame.test.js` - Added 9 new test cases covering text/--json shapes for both branches, error messages, the `--json` arg-not-mistaken-for-file case, and the duplicate-head_sha collision/stderr-sink/warnings-array behavior (pre-existing 11 tests untouched)

## Decisions Made
- See `key-decisions` in frontmatter: `line` key naming, single shared `records` array per blame.js invocation, and full-untruncated `subject` field in log.js JSON mode.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria (test suite green, additions-only diffs vs baseline `98679b8`, export checks, function-body slice checks, single `return lines.join(` occurrence, single `process.stderr.write` occurrence located inside `run`) passed on first implementation without needing fixes.

## Issues Encountered

None. Full repo test suite (`npm test`) passes at 234/234 after both tasks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `log.js` and `blame.js` now conform to the PHASE-WIDE compute/run CONTRACT that `show.js`/`diff.js` (07-03) and `cost.js` (07-04) must also follow — ready as a reference implementation for those sibling plans in the same wave/later waves.
- No blockers for Phase 8 (MCP server scaffold): `compute()` in both files is confirmed in-process-safe (no stdout writes, no `process.exit`), which is the exact property Phase 8/9's MCP tools require.

---
*Phase: 07-compute-run-split-cli-json-output*
*Completed: 2026-10-08*
