---
phase: 07-compute-run-split-cli-json-output
plan: 05
subsystem: testing
tags: [cli, json, node-test, child-process, documentation]

# Dependency graph
requires:
  - phase: 07-compute-run-split-cli-json-output (plans 02-04)
    provides: compute()/run() split and --json/--plain flags on log/show/diff/blame/cost
provides:
  - Cross-command compute() purity probe proving REFACTOR-01's output-free/exit-free guarantee across all five commands at once
  - CLI end-to-end regression test proving --plain byte-identity and the --json {error} contract through the real bin/git-turn entrypoint
  - AGENTS.md/README.md/--help documentation of --json, --plain, and the new rich diff/show default rendering
affects: [08-mcp-server-scaffold]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Child-process purity probe: stub all output sinks (console.*, process.stdout/stderr.write, process.exit) before requiring any compute() module, run in its own process so node:test's own reporter stream is never touched"

key-files:
  created:
    - src/helpers/compute-purity-probe.js
    - src/commands/compute-purity.test.js
  modified:
    - src/commands/show.js
    - src/blame-util.js
    - bin/git-turn
    - AGENTS.md
    - README.md

key-decisions:
  - "Split probe cases into 'ready' mode (session exists — success + not-found error paths) and 'uninit' mode (session.json deleted — not-initialized error paths), matching the plan's two-phase behavior spec exactly."
  - "Fixed two real purity leaks found by the new probe rather than treating them as test fixture issues: show.js's notes lookup and blame-util.js's untracked-file content lookup were both missing the stdio:['pipe','pipe','ignore'] override that log.js/cost.js already use for the same kind of expected-failure git call, so git's own stderr text ('no note found'/'path does not exist') was leaking to the real process.stderr on legitimate not-found paths."

requirements-completed: [REFACTOR-01, DIFF-01, JSON-01]

duration: ~55min
completed: 2026-10-08
---

# Phase 7 Plan 05: Compute-purity probe, CLI e2e gate, and --json/--plain docs Summary

**Cross-command compute() purity probe (REFACTOR-01) plus CLI e2e byte-identity/error-contract tests, and --json/--plain/rich-rendering documentation in --help, AGENTS.md, README.md — two of three tasks complete; the third is a human-verify checkpoint awaiting approval.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-10-08T15:06:00Z (approx, worktree reset)
- **Completed:** 2026-10-08T15:20:52Z (through Task 2; Task 3 paused)
- **Tasks:** 2 of 3 completed (Task 3 is a checkpoint awaiting human verification)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- Built `src/helpers/compute-purity-probe.js`: a standalone child-process script that stubs every output sink (`console.log/error/warn/info`, `process.stdout.write`, `process.stderr.write`, `process.exit`) before requiring any command module, then calls `compute()` on `log`/`show`/`diff`/`blame`/`cost` across success, `--json`, and error (not-found / not-initialized) paths, recording every sink call plus result/error shape.
- Built `src/commands/compute-purity.test.js`: drives the probe via `execFileSync` across two modes (`ready`, `uninit`) and asserts zero sink calls everywhere, string results for success cases, `JSON.parse`-able `--json` results, and real `Error` instances (never the `PROBE_EXIT` sentinel) for error cases. Also added CLI end-to-end tests through the real `bin/git-turn` binary proving `diff <N> <M> --plain` is byte-identical to `git diff` of the same snapshot shas, `--json` on diff carries numeric `added`/`removed`, and an uninitialized repo's `log`/`log --json` calls produce the documented stdout/stderr/exit-code contract.
- Found and fixed two real purity leaks via the probe (Rule 1 — see Deviations): `show.js` and `blame-util.js` were each missing a `stdio` override on a `gitSafe()` call, so git's own stderr text for an expected not-found case was leaking to the real process stderr unguarded by `opts.stderr`.
- Updated `bin/git-turn --help`, `AGENTS.md`, and `README.md` to document `--json` on `log`/`show`/`diff`/`blame`/`cost`, `--plain` on `show`/`diff` only, each command's JSON shape (verified against the actual code), the `{"error": "..."}` failure contract, and the new rich diff/show default rendering (summary line, line-number gutter, full-row backgrounds) vs. the `--plain` passthrough.

## Task Commits

1. **Task 1: Cross-command compute() purity probe + CLI end-to-end test** - `699f003` (test)
2. **Task 2: Document --json, --plain and rich rendering (help, AGENTS.md, README.md)** - `a56ffe8` (docs)
3. **Task 3: Visual check of rich diff rendering in a real terminal** - PENDING (checkpoint:human-verify, see below)

**Plan metadata:** not yet committed (plan incomplete — paused at Task 3 checkpoint)

## Files Created/Modified

- `src/helpers/compute-purity-probe.js` - Child-process probe stubbing all output sinks and calling compute() on all five commands
- `src/commands/compute-purity.test.js` - Drives the probe + CLI e2e tests asserting the purity and byte-identity/error-contract guarantees
- `src/commands/show.js` - Fix: added missing `stdio: ['pipe','pipe','ignore']` to the notes-lookup `gitSafe()` call
- `src/blame-util.js` - Fix: added missing `stdio: ['pipe','pipe','ignore']` to the untracked-file content-lookup `gitSafe()` call
- `bin/git-turn` - Help text now lists `[--json]`/`[--plain]` per command
- `AGENTS.md` - Documents `--json`/`--plain`, JSON shapes, `{error}` contract, rich rendering
- `README.md` - Commands block and example updated with `--json`/`--plain` and real rich-format sample output

## Decisions Made

- Probe cases split into `ready`/`uninit` modes per the plan's exact behavior spec, rather than a single combined case list, so the "delete session.json mid-run" state transition is unambiguous and isolated to its own child-process invocation.
- Both purity fixes applied inline as Rule 1 bug fixes (not deferred) since they directly violate this plan's own `must_haves` truth ("zero calls to console.*, process.stdout.write, process.stderr.write or process.exit") and were caught by the very automated gate this plan exists to build.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] show.js's notes lookup leaked git's stderr on expected not-found notes**
- **Found during:** Task 1 (running the new purity probe against `show('1')` after deleting the note, surfaced via the "ready mode: every success and not-found-error case records zero sink calls" test)
- **Issue:** `gitSafe(['notes', '--ref=...', 'show', head])` had no `stdio` override, so when a turn's HEAD commit has no note yet, git's own `"error: no note found for object <sha>."` text was written directly to the real `process.stderr` instead of being silently swallowed (as `log.js`/`cost.js` already do for the identical call).
- **Fix:** Added `{ stdio: ['pipe', 'pipe', 'ignore'] }` to match the pattern already used in `log.js`/`cost.js`.
- **Files modified:** `src/commands/show.js`
- **Verification:** `node --test src/commands/compute-purity.test.js` — zero sink calls recorded for all cases; full `npm test` suite green (286/286).
- **Committed in:** `699f003` (Task 1 commit)

**2. [Rule 1 - Bug] blame-util.js's untracked-file content lookup leaked git's stderr on a nonexistent path**
- **Found during:** Task 1 (probing `blame(['nonexistent.txt'])` in the untracked-fallback path)
- **Issue:** `gitSafe(['show', snapshotSha + ':' + file])` in `annotateFromSnapshots()` had no `stdio` override, so git's `"fatal: path '<file>' does not exist in '<sha>'."` was written directly to real `process.stderr` for the normal, expected case of querying a file that was never captured in any snapshot.
- **Fix:** Added `{ stdio: ['pipe', 'pipe', 'ignore'] }` to the call.
- **Files modified:** `src/blame-util.js`
- **Verification:** Same as above — purity probe + full suite green.
- **Committed in:** `699f003` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs caught by the new purity gate itself)
**Impact on plan:** Both fixes are exactly what this plan's purity probe is designed to catch; no scope creep, no architectural change. REFACTOR-01's "nothing reachable from compute() writes or exits" guarantee now actually holds for all five commands, not just four.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Tasks 1 and 2 are complete and committed (`699f003`, `a56ffe8`); `npm test` is green (286/286) with both commits applied.
- **Task 3 is a `checkpoint:human-verify` and has NOT been attempted or resolved** — this plan is NOT complete. A fresh agent/continuation must present the six how-to-verify steps in 07-05-PLAN.md Task 3 to the user and await an "approved" response (or a description of what looks wrong) before this plan can be marked done and its metadata commit created.
- The automated pre-check for Task 3 (`NO_COLOR=1 node -e "...renderRich..."`) was run as a sanity check and passes, confirming the renderer function itself behaves as expected — this is NOT a substitute for the required human visual approval in a real terminal.
- Do not update STATE.md/ROADMAP.md/REQUIREMENTS.md for this plan yet — those updates (including marking REFACTOR-01/DIFF-01/JSON-01 complete) should wait until Task 3 is approved and the plan is fully done, per the orchestrator's ownership of those shared files.

---
*Phase: 07-compute-run-split-cli-json-output*
*Completed: Tasks 1-2 only, 2026-10-08 — plan incomplete, awaiting Task 3 checkpoint approval*

## Self-Check: PASSED

- FOUND: src/helpers/compute-purity-probe.js
- FOUND: src/commands/compute-purity.test.js
- FOUND: commit 699f003
- FOUND: commit a56ffe8
