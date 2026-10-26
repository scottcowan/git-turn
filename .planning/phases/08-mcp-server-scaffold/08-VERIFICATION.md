---
phase: 08-mcp-server-scaffold
verified: 2026-10-26T12:58:39Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Register git turn mcp with a real MCP client (e.g. `claude mcp add git-turn -- git turn mcp`) and confirm the client shows git-turn connected with zero tools"
    expected: "Client completes the capability-negotiation handshake against the real server binary (not a hand-built JSON-RPC harness) and lists zero tools"
    why_human: "Requires an actual MCP client application; this is explicitly deferred by the plan itself to Phase 10's VERIFY-04 end-to-end check, but the phase's own ROADMAP success criterion 1 says 'with a real MCP client' — the automated subprocess test and this verifier's manual JSON-RPC probe both only simulate a client by writing raw JSON-RPC frames over stdio, which is strong evidence but not the literal real-client check"
---

# Phase 8: MCP Server Scaffold Verification Report

**Phase Goal:** `git turn mcp` starts a long-running stdio MCP server, correctly scoped to the invoking repo, with no tools registered yet. Also fixes a pre-existing bug: `cost --all` is parsed but never applied.
**Verified:** 2026-10-26T12:58:39Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `git turn mcp` in an initialized repo completes `initialize`/`notifications/initialized` handshake with a real MCP client | ✓ VERIFIED (automated) | Live manual probe (spawned `bin/git-turn mcp` as a real child process, wrote raw JSON-RPC `initialize` over stdin) returned `{"result":{"protocolVersion":"2025-11-25","capabilities":{},"serverInfo":{"name":"git-turn","version":"0.1.0"}},"jsonrpc":"2.0","id":1}`; also covered by `src/commands/mcp.test.js` subtest 2 (passing in full `npm test` run, 296/296). Not yet exercised against an actual third-party MCP client binary — see Human Verification. |
| 2 | `git turn mcp` in a never-`init`'d repo fails loudly on stderr and exits, no server left running | ✓ VERIFIED | Live manual repro in a fresh `git init`-only repo: stdout empty, stderr exactly `git turn: not initialized. Run \`git turn init\` first.`, exit code 1. `ps aux` confirmed no lingering process. Matches `src/commands/mcp.js:12-17`. |
| 3 | Server stays alive while stdio open, exits cleanly on stdin-close or SIGINT, no reachable `process.exit` | ✓ VERIFIED | Live manual probe: stdin-close -> `exitCode 0`; SIGINT -> `exit code: 0 signal: null`. Source: single `process.exit(1)` in `src/commands/mcp.js:15`, strictly before `serveStdio()` on line 24; `src/mcp/server.js` has zero `process.exit`/`process.on`. Confirmed via both grep and reading the full file. |
| 4 | cwd captured once at startup, never re-resolved per tool call | ✓ VERIFIED | `src/commands/mcp.js:22` — exactly one `process.cwd()` call, assigned to `repoPath` before `serveStdio()`. `src/mcp/server.js` contains zero `process.cwd()` calls (no tools exist yet to re-resolve anything, which is itself consistent with the "zero tools" scope). |
| 5 | `git turn cost --all` reports across every session using the same `listAllTurns({ noCache })` helper `blame`/`bisect`/`heatmap` use | ✓ VERIFIED | `src/commands/cost.js:176` calls `listAllTurns({ noCache: args.includes('--no-cache') })`, imported from `../blame-util` (same helper, not a reimplementation). Grouped by session, rendered via shared `renderSession()`, grand total appended. `src/commands/cost.test.js`'s `describe('cost --all (COST-01)')` block (4 tests: plain-text multi-session, `--json` multi-session, no-`--all` regression guard, `--no-cache` ref-walk fallback) all pass in the full suite run. Single-session path unchanged (regression test asserts byte-equivalent framing). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/mcp/server.js` | `createServer()` factory, zero tools, no lifecycle code | ✓ VERIFIED | Exports `{ createServer }`; `new McpServer({ name: 'git-turn', version })`; no `registerTool`, no `process.exit/on/cwd`, no console/stdout. |
| `src/commands/mcp.js` | bootstrap: validate, capture cwd, serveStdio, SIGINT | ✓ VERIFIED | Exports `{ run }`; matches all behaviors above. |
| `src/commands/mcp.test.js` | subprocess integration tests, >=80 lines | ✓ VERIFIED | 7 subtests, all passing in isolated `node --test` pass per the split test script. |
| `bin/git-turn` | `'mcp'` in `COMMANDS` + `--help` line | ✓ VERIFIED | `COMMANDS` array includes `'mcp'`; help text has the documented line. |
| `src/commands/cost.js` | `--all` branch driven by `listAllTurns({ noCache })` | ✓ VERIFIED | Confirmed by direct read, line 176. |
| `package.json` | `@modelcontextprotocol/server@2.3.1`, `zod@4.6.5` exact pins | ✓ VERIFIED | Both present, exact (no caret); `package-lock.json` committed with integrity hashes (not re-read line-by-line but presence confirmed via `npm ls`/install evidence in Plan 02's verify steps and current `node_modules`/require resolution working in live tests above). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/commands/mcp.js` | `@modelcontextprotocol/server/stdio` `serveStdio` | `serveStdio(createServer)` | ✓ WIRED | Confirmed in source; confirmed working live (real handshake succeeded). |
| `src/commands/mcp.js` | `src/session.js` `readSession` | null check before `serveStdio` | ✓ WIRED | Confirmed in source and live (uninitialized-repo test). |
| `bin/git-turn` | `src/commands/mcp.js` | `COMMANDS` array dispatch | ✓ WIRED | Confirmed; `node bin/git-turn mcp` actually dispatches to this module (live test). |
| `src/commands/cost.js` `compute() --all` | `src/blame-util.js` `listAllTurns` | `listAllTurns({ noCache: ... })` | ✓ WIRED | Confirmed in source (line 176, 9) and by passing cross-session tests. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Real handshake over stdio | spawned `bin/git-turn mcp`, wrote JSON-RPC `initialize` | Correct `serverInfo.name: 'git-turn'` response | ✓ PASS |
| Uninitialized-repo failure | spawned `bin/git-turn mcp` in a `git init`-only dir, stdin `/dev/null` | stdout empty, stderr exact D-03 string, exit 1 | ✓ PASS |
| Clean shutdown on stdin close | ended child's stdin after handshake | `exitCode 0` | ✓ PASS |
| Clean shutdown on SIGINT | sent `SIGINT` to live child | `exit code 0, signal null` | ✓ PASS |
| `cost --all` cross-session (via existing test suite, not re-derived manually) | `node --test src/commands/cost.test.js` (part of full run) | 4/4 `--all` tests pass | ✓ PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` files exist in this repo and neither PLAN nor SUMMARY declares any probe script for this phase. Skipped — not applicable to this phase's shape (this is a feature-development phase, not a migration/tooling phase with probe scripts).

### Test Suite (independently run, not trusted from SUMMARY)

`npm test` executed fresh by this verifier (after discovering and killing a stray duplicate concurrent `npm test` the verifier itself had accidentally launched — notably, that collision reproduced exactly the kind of `node --test` subprocess-contention symptom the SUMMARY's test-infra investigation describes, which is corroborating evidence for that investigation's root-cause finding, not a contradiction of it). Clean single run result:

```
# tests 289
# pass 289
# fail 0
...
(mcp.test.js, isolated pass)
# tests 7
# pass 7
# fail 0
```

296/296 total, 0 failures, exit code 0. Confirms the SUMMARY's test-infra fix claim is real, not narrated.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| MCP-01 | 08-03 | stdio server implements initialize/notifications/initialized/tools-list/tools-call, scoped to cwd | ✓ SATISFIED | Live handshake verified; SDK (`McpServer`) handles `tools/list`/`tools/call` generically even with zero registered tools (returns empty list / method-appropriate response) — consistent with "no tools registered yet" phase scope. |
| MCP-02 | 08-03 | validates init at startup, fails loudly on stderr, never re-reads cwd per call | ✓ SATISFIED | Live repro + source read (single `process.cwd()` call). |
| MCP-03 | 08-03 | stays alive until stdio closes, exits cleanly on stdin-close/SIGINT | ✓ SATISFIED | Live repro for both paths. |
| COST-01 | 08-01 | `cost --all` reports across all sessions via `listAllTurns({ noCache })` | ✓ SATISFIED | Source + passing cross-session test suite. |

**Orphaned requirements check:** `.planning/REQUIREMENTS.md`'s traceability table maps only COST-01/MCP-01/MCP-02/MCP-03 to Phase 8; all four are claimed by the three plans. No orphans for this phase.

**Documentation staleness (flagged, non-blocking):** `.planning/REQUIREMENTS.md` still shows MCP-01/MCP-02/MCP-03 as unchecked `- [ ]` items and "Pending" in the traceability table, even though this phase's work (verified above) satisfies them. COST-01 was correctly updated to `[x]`/"Complete" by an earlier commit (`6624c54`). This is a requirements-ledger bookkeeping gap, not a code gap — recommend updating REQUIREMENTS.md's checkboxes and traceability table for MCP-01/02/03 to Complete as part of phase closeout.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER found in any file modified by this phase | - | - |

Four Warning-level and three Info-level findings exist in `.planning/phases/08-mcp-server-scaffold/08-REVIEW.md` (0 Critical). These are real robustness gaps (WR-01: `head_sha` unresolved falls back to querying notes under the wrong sha, silently mis-attributing missing-cost-data vs. structural failure; WR-02: `$()`/bash-specific test script, partially fixed post-review for the empty-match case but still bash-only, not Windows-portable; WR-03: no try/catch around `serveStdio()` itself; WR-04: SIGINT has no bounded timeout if `handle.close()` never settles) but none of them block the phase's stated goal — the server does start, scope correctly, and shut down cleanly in every tested path, and `cost --all` does aggregate correctly for well-formed data. They are legitimate follow-up items for Phase 9 hardening, not phase-8 blockers.

## Human Verification Required

### 1. Real third-party MCP client connection

**Test:** Run `claude mcp add git-turn -- git turn mcp` (or equivalent for another MCP client) inside a git-turn-initialized repo, then ask the client to list its connected servers/tools.
**Expected:** Client shows `git-turn` connected, handshake succeeded, zero tools listed.
**Why human:** ROADMAP success criterion 1 explicitly says "with a real MCP client." This verifier's live probe and the automated `mcp.test.js` suite both simulate a client by writing raw JSON-RPC frames directly over stdio pipes — strong, passing evidence that the protocol-level behavior is correct, but not literally a third-party MCP client application's own negotiation path (e.g. real clients may send different capability negotiation fields, different protocolVersion values, or exercise `tools/list` which was not separately probed here). The plan itself explicitly defers this exact check to Phase 10's VERIFY-04 as "Manual-Only, not blocking this plan." Routing it here as human_needed rather than silently passing is intentional given the roadmap's own wording.

## Gaps Summary

No code-level gaps found. All 5 roadmap success criteria and all 4 requirement IDs (MCP-01, MCP-02, MCP-03, COST-01) are verified against the actual source and confirmed with live, independently-run manual process spawns (not just unit tests, not just SUMMARY narrative). `npm test` was independently re-run by this verifier and passed 296/296.

The only reason this report is not a plain `passed` is the one human-verification item above, which the phase's own plan explicitly deferred to a later phase's E2E check — surfaced here per the escalation-gate pattern rather than silently waived. A non-blocking documentation-staleness note (REQUIREMENTS.md checkboxes) is recorded for phase closeout but does not affect status.

---
*Verified: 2026-10-26T12:58:39Z*
*Verifier: Claude (gsd-verifier)*
