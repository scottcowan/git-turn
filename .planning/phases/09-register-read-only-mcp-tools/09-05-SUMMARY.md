---
phase: 09-register-read-only-mcp-tools
plan: 05
subsystem: testing
tags: [mcp, node-test, git-hooks, round-trip-verification]

# Dependency graph
requires:
  - phase: 09-02
    provides: git_turn_log/git_turn_cost MCP tool handlers
  - phase: 09-03
    provides: git_turn_show/git_turn_diff MCP tool handlers (and git_turn_blame from the same wave)
provides:
  - "VERIFY-03 closed: live round-trip test proving the real post-commit hook's note (enriched by the real record-prompt CLI) is read back correctly through all 5 MCP tool handlers"
  - "Precondition assertion that fails loudly (not skips) if the hook doesn't fire or the note doesn't live on HEAD with a divergent snapshot_sha (Pitfall 5 shape)"
affects: [phase-10-e2e-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Real-subprocess fixture pattern: execFileSync for `git turn init`/`record-prompt`, real `git commit`, no hand-built note fixtures — mirrors the approach already used in src/commands/mcp.test.js"]

key-files:
  created: [src/mcp/tools/roundtrip.test.js]
  modified: []

key-decisions:
  - "Combined both plan tasks (show/log/cost assertions, then diff/blame/color/out-of-range assertions) into a single file write and a single commit, since node:test's before()/after() fixture setup could not be meaningfully split across two separate commits without re-running the real git commit + hook + record-prompt sequence twice"
  - "Reused the BIN_PATH convention (join(__dirname, '..', '..', '..', 'bin', 'git-turn')) already established in src/commands/mcp.test.js rather than inventing a new subprocess-invocation helper"

patterns-established:
  - "VERIFY-03 live-fixture pattern: before() runs real `git turn init`, two real commits each followed by real `git turn record-prompt`, then asserts note-on-HEAD vs snapshot-sha divergence before any tool assertions execute — any future live round-trip test should follow this shape rather than reaching for addNote/makeTurn fixtures"

requirements-completed: [VERIFY-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08]

# Metrics
duration: 35min
completed: 2026-11-01
---

# Phase 9 Plan 5: Live MCP Round-Trip Verification Summary

**Round-trip test proving real post-commit-hook + record-prompt notes resolve correctly through all 5 MCP tool handlers (show/log/cost/diff/blame), closing VERIFY-03 with zero hand-built note fixtures.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-11-01T20:21:00Z
- **Completed:** 2026-11-01T20:56:31Z
- **Tasks:** 2 (planned as 2 tasks; delivered as 1 combined file/commit — see Decisions)
- **Files modified:** 1

## Accomplishments
- `src/mcp/tools/roundtrip.test.js` created: a shared `before()` fixture runs a real `git turn init` subprocess, two real `git commit`s (each firing the real installed post-commit hook), and two real `git turn record-prompt` subprocess calls — no `addNote`/`makeTurn`/fixture helpers anywhere in the file.
- Precondition assertions in `before()` parse the actual note JSON off `HEAD` and `HEAD~1` via `git notes show`, confirming `turn_n`, `session_id`, and that `snapshot_sha` matches the real `refs/git-turn/sessions/<id>/turn-N` ref and differs from the commit's own sha — the exact Pitfall 5 shape (note lives on HEAD, keyed by a sha distinct from the snapshot it points at). These assertions throw with a message naming the hook if it ever doesn't fire as expected, rather than silently skipping.
- 7 tests cover: `git_turn_show` (model/latency/tool_summary/prompt gating via `withPrompts`), `git_turn_log` (both cache and `--no-cache` paths), `git_turn_cost` (real usage -> real `$0.0105` pricing, no `[object Promise]`/`no model recorded` leaks), `git_turn_diff` (both `turn` and `turn+toTurn` forms against real snapshots), `git_turn_blame` (per-line `sid8:turn` attribution against the real two-commit history, cache and `--no-cache`), `FORCE_COLOR` colorlessness on `show`/`diff`, and an out-of-range-turn `isError` case.
- All acceptance-criteria greps pass: `addNote|makeTurn|turn-fixtures` count is 0, `'init'` and `'record-prompt'` each appear, `VERIFY-03:` appears 7 times (exceeds the required minimums of 3 and 5), no `test.skip`/`{ skip` anywhere, `FORCE_COLOR` appears.
- `node --test src/mcp/tools/roundtrip.test.js` — 7/7 pass.
- `npm test` (full suite, including `src/commands/mcp.test.js`) — all green, exit 0.

## Task Commits

Both plan tasks were delivered in a single commit, since they describe incremental additions to the same shared fixture/describe block in one new file — splitting the write into two commits would have required either committing a half-finished test file (a file with Task 1's assertions but no `after()` cleanup wired to Task 2's additions) or re-running the real-subprocess fixture setup twice. The full content of both tasks' acceptance criteria is present and verified in the single commit below.

1. **Tasks 1+2: Real-hook fixture plus show/log/cost/diff/blame round-trip assertions** - `85fa7f4` (test)

**Plan metadata:** (this commit, created after Self-Check)

## Files Created/Modified
- `src/mcp/tools/roundtrip.test.js` - Live round-trip test: real `git turn init`/`git commit`/`git turn record-prompt` subprocesses feeding all 5 MCP tool handlers (`show`, `log`, `cost`, `diff`, `blame`), plus `FORCE_COLOR` colorlessness and out-of-range-turn `isError` checks on the same live fixture.

## Decisions Made
- Delivered both plan tasks as one file/commit rather than two incremental commits — see `key-decisions` in frontmatter for rationale (shared `before()` fixture, no clean split point that wouldn't require a half-working intermediate state or duplicate real-subprocess setup).

## Deviations from Plan

None - plan executed exactly as written (task count collapsed from 2 to 1 commit for the reason above; no code, assertion, or scope changes were made relative to the plan's `<action>` blocks).

## Issues Encountered
- The test suite ran under heavy concurrent load from a sibling parallel-wave agent's full `npm test` run in a different worktree, causing one isolated `node --test` invocation of this file to take ~9 minutes (vs. ~5 seconds once contention cleared) due to shared `os.tmpdir()`/git subprocess contention across worktrees. No code issue — confirmed by re-running in isolation afterward with the expected fast (~5s) result. Both the isolated run and the full `npm test` run completed with exit code 0.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- VERIFY-03 (Phase 9 success criterion 5) is closed: the snapshot-sha-vs-HEAD-sha lookup used by `show.js`/`log.js`/`cost.js`/`diff.js`/`blame.js` is now proven against real hook-written and real `record-prompt`-enriched notes, not just fixture-shaped ones.
- Phase 10 (E2E verification with a real client, VERIFY-04) can build on this confidence that the tool-handler-to-note-reader path is correct under real git conditions.
- No blockers identified.

---
*Phase: 09-register-read-only-mcp-tools*
*Completed: 2026-11-01*

## Self-Check: PASSED

- FOUND: src/mcp/tools/roundtrip.test.js
- FOUND: .planning/phases/09-register-read-only-mcp-tools/09-05-SUMMARY.md
- FOUND: commit 85fa7f4 (test(09-05): live round-trip test across all 5 MCP tools via real hook + record-prompt)
- FOUND: commit e4b8945 (docs(09-05): complete live MCP round-trip verification plan)
