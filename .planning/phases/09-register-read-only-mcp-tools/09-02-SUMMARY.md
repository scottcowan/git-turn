---
phase: 09-register-read-only-mcp-tools
plan: 02
subsystem: api
tags: [mcp, zod, model-context-protocol, cli-adapter]

# Dependency graph
requires:
  - phase: 08-mcp-server-scaffold
    provides: "src/mcp/server.js createServer() scaffold, compute()/run() split on every src/commands/*.js (Phase 7 prerequisite)"
provides:
  - "git_turn_log, git_turn_blame, git_turn_cost MCP tool adapters with { register, handler } exports"
  - "Verified note-backed round-trip (VERIFY-03) pattern for log and cost, reusable for show/diff adapters in 09-01"
affects: [09-register-read-only-mcp-tools, 10-mcp-e2e-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP tool adapter shape: async handler(params) reconstructs CLI argv from camelCase zod params, calls existing compute(argv), returns { content, isError } — never throws"
    - "isError contract: every thrown compute() Error surfaces as { content: [{ type: 'text', text: e.message }], isError: true } with the message verbatim"

key-files:
  created:
    - src/mcp/tools/log.js
    - src/mcp/tools/log.test.js
    - src/mcp/tools/blame.js
    - src/mcp/tools/blame.test.js
    - src/mcp/tools/cost.js
    - src/mcp/tools/cost.test.js
  modified: []

key-decisions:
  - "blame adapter passes a no-op stderr sink to compute() so the terminal-only duplicate-sha warning never reaches the MCP server's real stderr"
  - "cost adapter omits opts.stderr entirely (rather than a no-op) since cost.js guards every stderr call with `if (opts.stderr)`, so omission is the simplest suppression"

patterns-established:
  - "Pattern: tool adapter test files live in src/mcp/tools/ and require fixtures via '../../helpers/...', two levels up from src/commands/*.test.js's one level"

requirements-completed: [MCP-04, MCP-07, MCP-08, MCP-09, VERIFY-03]

# Metrics
duration: 30min
completed: 2026-11-01
---

# Phase 9 Plan 2: git_turn_log/_blame/_cost MCP Adapters Summary

**Three thin MCP tool adapters (`git_turn_log`, `git_turn_blame`, `git_turn_cost`) that reconstruct CLI argv from camelCase zod params and mirror `compute()`'s text output exactly, including the one async adapter (`cost`) that must `await` its Promise to avoid `"[object Promise]"` leaking into tool results.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-11-01T18:54:05Z (first RED commit)
- **Completed:** 2026-11-01T19:22:30Z
- **Tasks:** 2
- **Files modified:** 6 (all new)

## Accomplishments
- `git_turn_log` and `git_turn_blame` adapters, each with `{ register, handler }` exports, camelCase zod schemas (D-03), and verbatim `isError` passthrough (MCP-09)
- `git_turn_cost` async adapter that awaits `compute()`, suppresses the pricing-fetch progress line, and surfaces pricing/uninitialized failures as `isError: true`
- VERIFY-03 live round-trip tests for both `log` (withPrompts via a hand-seeded note) and `cost` (model/usage via a hand-seeded note), proving the adapters read real notes, not fixtures shaped to match expectations
- Full `npm test` (305 non-mcp tests + 7 `mcp.test.js` tests = 312) green after both tasks

## Task Commits

Each task followed TDD RED -> GREEN:

1. **Task 1: git_turn_log and git_turn_blame adapters with tests**
   - `2cb972f` test(09-02): add failing tests for git_turn_log/blame adapters
   - `861a077` feat(09-02): implement git_turn_log and git_turn_blame MCP adapters
2. **Task 2: git_turn_cost async adapter with tests**
   - `455a07b` test(09-02): add failing test for git_turn_cost async adapter
   - `4aa9322` feat(09-02): implement git_turn_cost async MCP adapter

_No refactor commits needed — both tasks' GREEN implementations passed on the first attempt with no cleanup required._

## Files Created/Modified
- `src/mcp/tools/log.js` - `git_turn_log` adapter: argv `[withPrompts && '--with-prompts', noCache && '--no-cache']`, delegates to `src/commands/log.js`'s `compute()`
- `src/mcp/tools/log.test.js` - success-path text equality, VERIFY-03 note round-trip, MCP-09 uninitialized-repo isError test
- `src/mcp/tools/blame.js` - `git_turn_blame` adapter: `file: z.string().min(1)` required param (Pitfall C — prevents a non-string reaching `compute()`'s `args.find(a => !a.startsWith('--'))`), no-op stderr sink
- `src/mcp/tools/blame.test.js` - success-path equality across three turns, no-history isError test, uninitialized-repo isError test, zero-stderr-writes assertion
- `src/mcp/tools/cost.js` - `git_turn_cost` adapter: async handler, `await compute(argv)` (Pitfall A), no `opts.stderr` passed
- `src/mcp/tools/cost.test.js` - VERIFY-03 round-trip asserting `$0.0105` and no `[object Promise]`/`no model recorded`, text equality for `{}`/`{ all: true }`, `instanceof Promise` check, pricing-failure and uninitialized isError tests, zero-stderr-writes assertion

## Decisions Made
- Followed PATTERNS.md templates verbatim for all three adapters — no deviation from the researched/pattern-mapped shape
- `blame`'s no-op stderr sink vs. `cost`'s omitted `opts.stderr`: chosen per each command's own internal guard style (`blame.js` always calls `opts.stderr(...)` when present with no internal guard around individual calls other than the `if (opts.stderr)` wrapper at the call site in `log.js`/`blame.js`; `cost.js` guards every call with `if (opts.stderr)` so simply not passing it is sufficient and simpler than a no-op function)

## Deviations from Plan

None - plan executed exactly as written. Every behavior in the plan's `<behavior>` blocks was implemented as a corresponding test, and all acceptance criteria greps pass.

## Issues Encountered

None. `npm install` was required once at the start of the session since the worktree didn't carry the main repo's `node_modules` (expected for git worktrees); installed `zod`/`@modelcontextprotocol/server` per `package.json`, matching versions already present in the main repo's `node_modules`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `git_turn_log`, `git_turn_blame`, `git_turn_cost` adapters are ready for `src/mcp/server.js` registration, which Plan 01 (running in parallel, same wave) owns per PATTERNS.md's "MODIFIED — provider/registration" section
- The VERIFY-03 live-round-trip pattern demonstrated here (seed a real note via `addNote`, assert the adapter reads it, not a hand-built fixture) is directly reusable for Plan 01's `show`/`diff` adapter tests
- Full test suite (312 tests) green; no known stubs or threat-surface gaps beyond what the plan's `<threat_model>` already covers

## Threat Flags

None - no new network endpoints, auth paths, or trust-boundary surface introduced beyond what the plan's threat register (T-09-04 through T-09-08) already anticipated and mitigated (zod primitive typing on all three schemas, try/catch around every `compute()` call, no `process.exit`/`.run(` reachable from any adapter).

---
*Phase: 09-register-read-only-mcp-tools*
*Completed: 2026-11-01*

## Self-Check: PASSED

All 6 created tool files and the SUMMARY.md verified present on disk; all 5 task/docs commits (2cb972f, 861a077, 455a07b, 4aa9322, 068fc15) verified present in `git log`.
