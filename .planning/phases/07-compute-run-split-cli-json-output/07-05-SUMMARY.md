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
completed: 2026-10-12
---

# Phase 7 Plan 05: Compute-purity probe, CLI e2e gate, and --json/--plain docs Summary

**Cross-command compute() purity probe (REFACTOR-01) plus CLI e2e byte-identity/error-contract tests, --json/--plain/rich-rendering documentation, and a human-approved visual check of the rich diff renderer — all three tasks complete.**

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
3. **Task 3: Visual check of rich diff rendering in a real terminal** - APPROVED (checkpoint:human-verify, see below)

## Checkpoint Resolution (Task 3)

**Type:** checkpoint:human-verify, gate=blocking
**Verdict:** APPROVED (2026-10-12)

The orchestrator ran the plan's 6 verification steps in a scratch repo (`git turn init`, two real commits producing a two-turn diff) and confirmed structurally:

1. **Default rich diff** (`git turn diff 2`): "Added 6 / removed 2" summary header first, dim diff/hunk headers (`\x1b[2m`), new-file-only gutter (blank for removed rows), full-row ANSI background highlighting (`\x1b[48;5;52m` dark red for removed, `\x1b[48;5;22m` dark green for added), `+`/`-`/space markers present on every content row, context rows correctly unhighlighted.
2. **`show <N>`**: identical rich diff correctly rendered below the Turn/Model header block.
3. **`NO_COLOR=1`**: gutter, summary, and markers preserved; zero ANSI escape bytes in output.
4. **`--plain`**: byte-for-byte identical to the pre-phase foreground-only `git diff --color=always` passthrough (no gutter, no summary) — confirmed by direct terminal comparison.
5. **`--json`**: `log --json` is a valid JSON array; `diff --json` returns `{from_turn, to_turn, sha_a, sha_b, diff, added, removed}` with correct added/removed counts (6/2, matching the summary header).
6. **Narrow terminal** (width:40 override via direct `renderRich()` call): rows respect the width option, no crashes or broken highlighting at reduced width.

The user accepted this structural/escape-code verification as sufficient evidence in lieu of personally re-running all 6 steps in their own terminal, and replied "approved."

**Plan metadata:** committed in this update (plan now complete — all 3 tasks done)

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

- All 3 tasks complete and committed. Task 3's checkpoint was approved on 2026-10-12 after the orchestrator ran the plan's 6 verification steps against a real scratch repo (see Checkpoint Resolution above).
- `npm test` reconfirmed green after the checkpoint resolution commit.
- Orchestrator should now update STATE.md/ROADMAP.md/REQUIREMENTS.md to mark REFACTOR-01/DIFF-01/JSON-01 complete for Phase 7, per its ownership of those shared files.

---
*Phase: 07-compute-run-split-cli-json-output*
*Completed: 2026-10-12 — all 3 tasks done, Task 3 checkpoint approved*

## Self-Check: PASSED

- FOUND: src/helpers/compute-purity-probe.js
- FOUND: src/commands/compute-purity.test.js
- FOUND: commit 699f003
- FOUND: commit a56ffe8
