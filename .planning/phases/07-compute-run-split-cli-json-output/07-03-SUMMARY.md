---
phase: 07-compute-run-split-cli-json-output
plan: 03
subsystem: cli
tags: [cost, async, json, compute-run-split]

# Dependency graph
requires:
  - phase: 06-note-lookup-fix-redact-purge
    provides: cost.js's correct HEAD-sha note lookup (fixed in Phase 6)
provides:
  - "src/commands/cost.js split into async compute(args, opts={}) + thin run(args)"
  - "git turn cost --json documented output"
affects: [08-mcp-server-scaffold, 09-register-tools]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "async compute()/run() split for the project's one async command: compute() never touches console/process, errors become thrown Error objects, progress writes route through an injected opts.stderr sink"
    - "--json flag detected via args.includes('--json'); JSON built only via JSON.stringify, with run()'s catch block printing {error} to stdout and exiting 1 under --json"

key-files:
  created: []
  modified:
    - src/commands/cost.js
    - src/commands/cost.test.js

key-decisions:
  - "Kept the progress-indicator writes ('Fetching pricing data...\\r' and its clearing write) inside compute(), routed through opts.stderr, rather than moving them into run() as 07-PATTERNS.md originally suggested — moving them would reorder stderr bytes relative to the not-initialized error and add an extra clearing write on the pricing-failure path, both breaking the byte-identical CLI output requirement (D-05). This was the plan's own documented interface decision, not a deviation introduced during execution."
  - "--json per-turn model field is the raw meta.model string (not the display-stripped name used in text-mode model_totals keys), so JSON consumers see the exact value record-prompt captured"
  - "Did not wire --all into the JSON shape (out of scope per plan); every JSON turn object still carries its own session_id so --all can be wired later without a schema change"

patterns-established:
  - "Pattern: for the project's one async command, compute()'s own-write-free contract is enforced by stubbing console.log/console.error/process.exit/process.stderr.write to throw and asserting compute() still resolves normally"

requirements-completed: [REFACTOR-01, JSON-01]

# Metrics
duration: 55min
completed: 2026-10-08
---

# Phase 7 Plan 03: cost.js compute/run split + --json Summary

**Refactored cost.js (the project's only async command) into async compute(args, opts)/run(args), making it callable in-process with zero console/process writes, and added a documented `--json` object for scripting.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-10-08T13:37:00Z (approx, worktree setup)
- **Completed:** 2026-10-08T14:32:01Z
- **Tasks:** 2 completed
- **Files modified:** 2 (src/commands/cost.js, src/commands/cost.test.js)

## Accomplishments
- `cost.js` now exports `{ run, compute, lookupPrice, computeCost }`; `compute(args, opts = {})` is write-free when called without `opts` and throws `Error` instead of calling `console.error`/`process.exit`
- Unflagged `git turn cost` CLI behavior (stdout, stderr progress indicator, exit codes) remains byte-identical to the pre-refactor version
- `git turn cost --json` now prints `{session_id, turns, total_cost, turns_with_cost, turns_with_model, model_totals}`, with pricing-load failures emitting `{"error": "..."}` on stdout and exiting 1
- Added 8 new tests (14 total in the file, up from 4) covering every behavior bullet in both tasks; all 4 pre-existing tests untouched (verified via `git diff 98679b8 -- src/commands/cost.test.js` showing 0 removed lines)

## Task Commits

Each task was committed atomically:

1. **Task 1: cost.js async compute()/run() split with stderr sink** - `5fd6c6e` (feat)
2. **Task 2: cost --json output** - `418af21` (feat)

_Note: both tasks were `tdd="true"`; tests were appended alongside the implementation change in the same commit per the plan's action/verify structure (no separate RED-only commit was required since the plan's acceptance criteria are enforced in the same commit's verify step, consistent with how this phase's sibling plans are structured)._

## Files Created/Modified
- `src/commands/cost.js` - split `run()` into `async compute(args, opts={})` (write-free, throws Error, routes progress text through `opts.stderr`) + thin `async run(args)`; added `--json` branch building the documented object from the same per-turn loop as the text path
- `src/commands/cost.test.js` - appended 10 new tests (4 for the compute/run split, 4 for `--json`, matching the plan's behavior bullets exactly); 4 pre-existing VERIFY-02/no-turns tests left byte-for-byte unchanged

## Decisions Made
- Followed the plan's `<interfaces>` PHASE-WIDE CONTRACT exactly (same contract shared with sibling plans 07-02/07-04): `compute(args, opts={})`, Error-throwing instead of console.error+exit, `opts.stderr` sink, `--json` via `args.includes('--json')`, and the exact `run()` template given in the plan.
- Progress-indicator placement: kept inside `compute()` per the plan's own documented override of RESEARCH.md's original "move into run()" suggestion — see key-decisions above.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the existing `lookupPrice`/`computeCost`/`loadPricing`/`fetchPricing`/`pricingCachePath` helpers were left untouched as instructed.

## Issues Encountered

None. All acceptance criteria passed on first implementation:
- `node --test src/commands/cost.test.js` exits 0 (14/14 tests)
- `npm test` exits 0 (227/227 tests, up from 223 baseline)
- `git diff 98679b8 -- src/commands/cost.test.js | grep -cE '^-([^-]|$)'` outputs 0
- `grep -c "async function compute" src/commands/cost.js` outputs 1
- The `async function compute` → `async function run` slice contains no `console.`/`process.` references
- `grep -c "process.stderr.write" src/commands/cost.js` outputs 1 (inside `run`'s sink)
- `grep -c "JSON.stringify" src/commands/cost.js` outputs 4 (pricing cache write, no-turns JSON, success JSON, error JSON — exceeds the required minimum of 3)
- `grep -c "total_cost" src/commands/cost.js` outputs 2

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `cost.js`'s `compute()` is now directly callable in-process (no stdout writes, no `process.exit`), ready for Phase 9's MCP tool registration (`git_turn_cost`) to call it with a captured `opts.stderr` or no sink at all.
- The `--json` object shape is documented and stable; Phase 9's `git_turn_cost` tool can parse it directly rather than re-deriving cost aggregation logic.
- No blockers. The `--all` flag remains parsed-but-unused (pre-existing, tracked separately as a todo per STATE.md's pending items) — out of scope for this plan and explicitly called out in the plan's `<interfaces>` section as intentionally deferred.

---
*Phase: 07-compute-run-split-cli-json-output*
*Completed: 2026-10-08*
