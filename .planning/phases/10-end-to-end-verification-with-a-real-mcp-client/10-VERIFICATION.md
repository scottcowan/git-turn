---
phase: 10-end-to-end-verification-with-a-real-mcp-client
verified: 2026-11-10T17:00:00Z
status: passed
score: 3/3 roadmap criteria verified (plus 4/4 plan-specific truths)
overrides_applied: 0
---

# Phase 10: End-to-end verification with a real MCP client - Verification Report

**Phase Goal:** A real MCP client (Claude Code) can drive git-turn's full read-only tool surface against real data, including graceful recovery from tool errors.
**Status:** passed
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Claude Code calls all 5 tools via `git turn mcp` against a real session | VERIFIED (partly independent) | 10-HUMAN-UAT steps 1-6 record per-tool tool_result evidence. I independently reproduced the real-client handshake and `git_turn_log` (below). The other 4 tools were not re-driven through a client by me; Phase 9 09-VERIFICATION and `roundtrip.test.js` cover them over stdio. |
| SC2 | Out-of-range turn or uninitialized repo is a recoverable tool error | VERIFIED | Reproduced: headless `claude -p` got `is_error: True`, text `git turn: turn 999 not found`. Uninit-at-startup reproduced: exit 1 and exact message. Mid-run uninit error is recorded in UAT step 8 (not reproduced; the source throws the exact string at `src/commands/log.js:80`). |
| SC3 | After a tool error, an unrelated call still succeeds in the same session | VERIFIED | Reproduced: `git_turn_log`, then 999 error, then `git_turn_log` again returned the full result in the same session, server status `connected`. |

## Independent Reproduction

I ran my own headless Claude Code client against a throwaway repo (`mktemp -d`, one commit after `git turn init`). I passed `--mcp-config` and `--strict-mcp-config` and restricted tools with `--allowedTools`. Nothing was registered globally.
- init event: `gt connected`
- `git_turn_log`: no `is_error`, text `Session: ... turn  1  e108ece  two ...`
- `git_turn_show` turn 999: `is_error=True`, text `git turn: turn 999 not found`
- `git_turn_log` again: success, identical text

## Static Checks

| Claim | Result |
|-------|--------|
| `git turn: turn 999 not found` in `src/commands/show.js` | Confirmed (line 26) |
| Not-initialized text in `src/commands/log.js` and `src/commands/mcp.js` | Confirmed (log.js:80, mcp.js:14) |
| `git turn mcp` exits 1 for a never-initialized repo | Confirmed (fresh `git init` dir: exact message, exit 1) |
| Note: `show.js:11` throws the shorter `git turn: not initialized` | Matches the plan's own note. This is not an inconsistency. |

## Cleanup / D-03

- `claude mcp list` has no `git-turn*` entries.
- `/tmp/git-turn-phase10` does not exist, and there is no `.mcp.json`.
- `git status` is clean, and there are no changes under `src/`, `package.json` or `package-lock.json`. Recent `src/` commits belong to Phase 9.
- 08-HUMAN-UAT.md shows `status: complete` and `result: pass`.
- My own temp dirs were removed.

## Requirements

VERIFY-04 is declared in the plan frontmatter and in REQUIREMENTS.md (line 45, traceability line 91, still "Pending"/unchecked). Evidence supports it, so the orchestrator should mark it complete. I did not edit REQUIREMENTS.md.

## Acknowledged Limitations (not blocking)

- The plan called for an interactive session and the `/mcp` UI. The run was headless instead, as 10-HUMAN-UAT.md "Method" and the SUMMARY disclose. The client is still the real Claude Code spawning `git turn mcp` over stdio. It exercises the same negotiation, tool-call and isError path, and I reproduced that path independently.
- The `/mcp` UI, the stderr/log view and a server PID were not observed. "Still connected" is inferred from later successful calls and from the init status. This does not weaken any ROADMAP criterion.
- The raw executor transcripts are gone, so UAT steps 3-6 and 8 rest on the write-up. They are consistent with source, the Phase 9 verification and the part I reproduced.
- The plan-level truth "interactive Claude Code session" is met only in spirit. It is documented as a user-directed deviation.

## Anti-Patterns

None. No source changes in this phase.

## Human Verification Required

None. An optional manual `/mcp` look is a nicety only.

---

_Verified: 2026-11-10_
_Verifier: Claude (gsd-verifier)_
