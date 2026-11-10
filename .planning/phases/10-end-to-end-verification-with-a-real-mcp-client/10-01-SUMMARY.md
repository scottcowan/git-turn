---
phase: 10-end-to-end-verification-with-a-real-mcp-client
plan: 01
subsystem: testing
tags: [mcp, claude-code, e2e, verification]

requires:
  - phase: 08-mcp-server-scaffold
    provides: "git turn mcp stdio server"
  - phase: 09-register-read-only-mcp-tools
    provides: "the 5 registered read-only tools"
provides:
  - "Live evidence that a real Claude Code client connects to git turn mcp, calls all 5 tools, and recovers from tool errors"
  - "Closed Phase 8's pending real-client UAT item"
affects: [milestone v0.4 close-out]

tech-stack:
  added: []
  patterns: ["headless `claude -p --output-format stream-json` as a real-client E2E harness, evidence taken from raw tool_result blocks"]

key-files:
  created: [.planning/phases/10-end-to-end-verification-with-a-real-mcp-client/10-HUMAN-UAT.md]
  modified: [.planning/phases/08-mcp-server-scaffold/08-HUMAN-UAT.md]

key-decisions:
  - "Ran the check as headless Claude Code sessions at the user's direction ('test it out yourself') instead of the interactive session the plan specified; recorded as a deviation in 10-HUMAN-UAT.md"
  - "Left the temporary registrations removed; the user can re-add permanently with `claude mcp add git-turn -- git turn mcp`"

requirements-completed: [VERIFY-04]

duration: ~30min
completed: 2026-11-10
---

# Phase 10 Plan 01: Real-client E2E verification Summary

**A real Claude Code client connected to `git turn mcp`, called all 5 tools against this repo's 43-turn history, got the exact CLI error text back as recoverable tool errors, and kept working afterwards; 9 of 9 checks passed.**

## Accomplishments
- Task 1: preflight passed (hook installed, 43 turns, binary resolves to this checkout), fixtures built, three local-scope servers registered. `git-turn` and `git-turn-fixture` connected; `git-turn-uninit` failed to connect by design.
- Task 2: all 9 checklist steps executed through headless Claude Code sessions and evidenced from the raw `tool_result` blocks. The 5 tools listed, returned CLI-identical text (cost output byte-identical to `git turn cost`), had zero ANSI bytes in show/diff, and `show 999` returned `is_error` with exactly `git turn: turn 999 not found`. With `session.json` moved aside under a running fixture server, `git_turn_log` returned exactly ``git turn: not initialized. Run `git turn init` first.`` and recovered once restored. Later calls succeeded after every error.
- Task 3: results recorded in `10-HUMAN-UAT.md`, `08-HUMAN-UAT.md` test 1 closed, all registrations and `/tmp/git-turn-phase10` removed.

## Task Commits
1. Task 1: no commit (no repo files touched)
2. Task 2: no commit (verification only)
3. Task 3: results and summary committed with the UAT files

## Files Created/Modified
- `.planning/phases/10-end-to-end-verification-with-a-real-mcp-client/10-HUMAN-UAT.md` - full record: method, setup, 9 tests, SC1-3 table, cleanup
- `.planning/phases/08-mcp-server-scaffold/08-HUMAN-UAT.md` - test 1 closed

## Deviations from Plan

**1. [User direction] Headless client instead of an interactive session**
- **Found during:** Task 2 checkpoint
- **Issue:** Plan D-01 specified a manual interactive session, and the checkpoint was waiting for the user to run it.
- **Fix:** The user asked for the check to be run by the executor. It ran as two `claude -p` sessions. This is a real Claude Code client, but evidence is the stream's init event and tool results rather than the `/mcp` UI; "still connected" is shown by later successful calls; "same server process" is inferred from a single session per server. All stated in 10-HUMAN-UAT.md.
- **Files modified:** none beyond the planned UAT files
- **Verification:** raw tool results parsed and checked programmatically (error flags, escape bytes, last turn vs `git turn status`, cost parity)

---

**Total deviations:** 1 (user-directed). **Impact:** the SC1-3 evidence is direct and machine-checked; the residual gap is that no human watched the `/mcp` UI.

## Issues Encountered
- The executor's own first fixture setup failed once because `rm` is aliased to `trash` and the path did not exist yet; nothing was left over and setup was re-run.

## User Setup Required
None. The server is intentionally no longer registered. To keep it available in Claude Code: `claude mcp add git-turn -- git turn mcp`.

## Next Phase Readiness
- All v0.4 requirements are now implemented; the milestone is ready for audit and completion.

---
*Phase: 10-end-to-end-verification-with-a-real-mcp-client*
*Completed: 2026-11-10*
