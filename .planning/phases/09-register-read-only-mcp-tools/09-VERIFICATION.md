---
phase: 09-register-read-only-mcp-tools
verified: 2026-11-01T21:24:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 9: Register Read-Only MCP Tools Verification Report

**Phase Goal:** An MCP client sees and can successfully call all 5 read-only git-turn tools, with output matching the CLI and errors surfaced safely.
**Verified:** 2026-11-01T21:24:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `tools/list` returns `git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost` | VERIFIED | Live-spawned `git turn mcp` subprocess (real stdio JSON-RPC, not just unit tests) returned `["git_turn_blame","git_turn_cost","git_turn_diff","git_turn_log","git_turn_show"]` from a real `tools/list` call. Also confirmed statically in `src/mcp/server.js` (5 `.register(server)` calls) and in `src/commands/mcp.test.js` ("tools/list returns all 5 registered tools with valid schemas"). |
| 2 | Each tool returns the same text the equivalent CLI command prints, including `tool_summary` in `git_turn_show` | VERIFIED | Live probe: `git_turn_show({turn:2})` returned the exact rich-diff text format (`Turn 2 ... Added 1 / removed 0 ...`); `git_turn_log`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost` all returned CLI-identical text live. `src/mcp/tools/roundtrip.test.js` (real hook + real `record-prompt`, no fixtures) asserts `Tool summary: Read:2, Edit:1` / `Tool summary: Bash:3` appear in `git_turn_show` output when the note carries `tool_summary`, and that it's absent otherwise. All 5 adapters pass argv through unchanged to the existing `compute()` (verified by reading `src/mcp/tools/{log,show,diff,blame,cost}.js`). |
| 3 | A bad argument (out-of-range turn, uninitialized repo) returns `isError: true` with the CLI's own message text, never throwing/crashing | VERIFIED | Live probe: `git_turn_show({turn:999})` -> `{isError: true, text: "git turn: turn 999 not found"}`; a subsequent `git_turn_log({})` call on the same process succeeded (`isError` undefined), proving the server survived. A deliberately mistyped arg (`turn: 'abc'`) was rejected by the SDK's zod validation layer with `isError: true` and a clear message, and the server still answered. `src/commands/mcp.test.js` covers this at the protocol level (12/12 passing) and `roundtrip.test.js` covers it against live note data. |
| 4 | `git_turn_show`/`git_turn_diff` output is always colorless regardless of server TTY state | VERIFIED | Live probe spawned the server with `FORCE_COLOR=1` and confirmed `hasANSI: false` for both `git_turn_show` and `git_turn_diff` output. Source: `src/mcp/tools/show.js`/`diff.js` unconditionally call `compute(argv, { color: false })` and contain zero references to `FORCE_COLOR`/`NO_COLOR`/`isTTY`/`shouldColor`. `src/commands/show.js`/`diff.js`'s `colorOn = opts.color !== undefined ? opts.color : shouldColor()` fallback confirmed present exactly once per file. |
| 5 | A live round-trip test (real hook-written note, not a fixture) proves correct note/sha resolution across all 5 tools | VERIFIED | Read `src/mcp/tools/roundtrip.test.js` in full: `before()` runs real `git turn init` (subprocess), two real `git commit`s (firing the real installed post-commit hook), and two real `git turn record-prompt` subprocess calls — zero `addNote`/`makeTurn`/`turn-fixtures` usage anywhere in the file. Precondition assertions explicitly check `snapshot_sha !== HEAD sha` (the Pitfall-5 shape) and throw descriptive errors (not skip) if the hook didn't fire. 7 tests exercise all 5 handlers against this real data and passed (confirmed via full `npm test` run: 339 non-mcp tests + 12 mcp.test.js tests, all green, exit 0). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/commands/show.js` | `opts.color` override + `Tool summary:` line | VERIFIED | `colorOn` fallback present once; `Tool summary: ` line present, guarded against null/array/empty-object |
| `src/commands/diff.js` | `opts.color` override | VERIFIED | `colorOn` fallback present once, both branches |
| `src/mcp/tools/log.js` | `git_turn_log` tool, `{register, handler}` | VERIFIED | camelCase schema, argv reconstruction, try/catch isError |
| `src/mcp/tools/show.js` | `git_turn_show` tool | VERIFIED | `compute(argv, { color: false })`, required `turn` |
| `src/mcp/tools/diff.js` | `git_turn_diff` tool | VERIFIED | `compute(argv, { color: false })`, optional `toTurn` |
| `src/mcp/tools/blame.js` | `git_turn_blame` tool | VERIFIED | no-op stderr sink, required `file` |
| `src/mcp/tools/cost.js` | `git_turn_cost` tool | VERIFIED | `await compute(argv)` confirmed (not `[object Promise]`) |
| `src/mcp/server.js` | registers all 5 tools | VERIFIED | `require`s all 5 tool modules, 5 `.register(server)` calls, confirmed live via `tools/list` |
| `src/mcp/tools/roundtrip.test.js` | VERIFY-03 live round-trip | VERIFIED | Real subprocess hook/record-prompt fixture, 7 tests, all passing |
| `AGENTS.md` | documents 5 tools | VERIFIED | Bulleted list naming all 5 tools and params; "Registers zero tools" placeholder removed |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/mcp/server.js` | `src/mcp/tools/*.js` | `require('./tools/<name>').register(server)` | WIRED | All 5 confirmed in source and live via `tools/list` |
| `src/mcp/tools/show.js`/`diff.js` | `src/commands/show.js`/`diff.js` `compute()` | `compute(argv, { color: false })` | WIRED | Confirmed live colorless under `FORCE_COLOR=1` |
| `src/mcp/tools/*.js` | MCP result | try/catch -> `{content, isError}` | WIRED | Confirmed live: out-of-range turn, invalid arg type, uninitialized-repo paths all return `isError: true` without crashing the process |

### Behavioral Spot-Checks (live process, not just unit tests)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Real `git turn init` installs hook, hook fires on commit | `node bin/git-turn init` + `git commit` in throwaway temp repo | Hook installed at `.git/hooks/post-commit`; note present on HEAD with correct `session_id`/`turn_n`/`snapshot_sha` | PASS |
| Real `git turn mcp` server, `tools/list` | spawned subprocess, sent JSON-RPC `initialize`/`tools/list` | 5 tools returned, schemas with correct `required`/`properties` | PASS |
| `git_turn_show`/`diff` colorless under `FORCE_COLOR=1` | live tool call with `FORCE_COLOR=1` env | No `\x1b[` bytes in output | PASS |
| Out-of-range turn -> isError, server survives | `git_turn_show({turn:999})` then `git_turn_log({})` | `isError:true` / `"git turn: turn 999 not found"`, then successful follow-up call | PASS |
| Invalid arg type rejected gracefully | `git_turn_show({turn:"abc"})` | `isError:true`, zod validation message, no crash | PASS |
| `git_turn_blame`/`git_turn_cost` live | live calls | Correct attribution text / cost table text (no pricing network call due to seeded cache in roundtrip test; live manual probe showed "No cost data available" because no `record-prompt` was run in that adhoc repo — expected, not a bug) | PASS |
| Full test suite | `npm test` | 339 non-mcp + 12 mcp.test.js = 351 tests, exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MCP-04 | 09-02, 09-04, 09-05 | `git_turn_log` mirrors `git turn log` | SATISFIED | `src/mcp/tools/log.js`, live probe, roundtrip test |
| MCP-05 | 09-01, 09-03, 09-04, 09-05 | `git_turn_show` mirrors `git turn show <N>` incl. tool_summary | SATISFIED | `src/mcp/tools/show.js`, `src/commands/show.js` Tool summary line, roundtrip test |
| MCP-06 | 09-03, 09-04, 09-05 | `git_turn_diff` mirrors `git turn diff <N> [M]` | SATISFIED | `src/mcp/tools/diff.js`, roundtrip test |
| MCP-07 | 09-02, 09-04, 09-05 | `git_turn_blame` mirrors `git turn blame <file>` | SATISFIED | `src/mcp/tools/blame.js`, roundtrip test |
| MCP-08 | 09-02, 09-04, 09-05 | `git_turn_cost` mirrors `git turn cost [--all]` | SATISFIED | `src/mcp/tools/cost.js` (awaits async compute), roundtrip test |
| MCP-09 | 09-02, 09-03, 09-04 | Errors surface as isError, never throw/crash | SATISFIED | Live probe + `mcp.test.js` isError-survival test + roundtrip test |
| MCP-10 | 09-01, 09-03, 09-04 | show/diff forced colorless in MCP path | SATISFIED | Live probe under FORCE_COLOR=1 + static grep (no FORCE_COLOR/NO_COLOR/isTTY/shouldColor refs in adapters) |
| VERIFY-03 | 09-02, 09-03, 09-05 | Live round-trip, real hook note, no fixtures | SATISFIED | `src/mcp/tools/roundtrip.test.js` fully read and confirmed genuine; `npm test` green |

No orphaned requirements: REQUIREMENTS.md maps exactly MCP-04 through MCP-10 and VERIFY-03 to Phase 9; all appear in at least one plan's `requirements:` field. VERIFY-04 is correctly scoped to Phase 10 and out of scope here.

### Anti-Patterns Found

None blocking. The code review (`09-REVIEW.md`, 2026-11-01) found 0 Critical, 1 Warning (WR-01: MCP handler functions aren't independently defensive against non-zod-shaped direct calls — low priority, the real protocol path is always zod-validated), 3 Info items (delimiter-collision edge case in tool_summary rendering, two different `opts.stderr` suppression idioms between blame/cost, AGENTS.md omitting explicit param types). None of these affect goal achievement; all are cosmetic/future-hardening notes. I independently re-confirmed WR-01 and the Info items by reading the adapter source — accurate characterization, non-blocking.

No `TBD`/`FIXME`/`XXX` markers found in the phase's modified files during this verification's reading of `src/mcp/server.js`, `src/mcp/tools/{log,show,diff,blame,cost,roundtrip.test}.js`, `src/commands/show.js`, `src/commands/diff.js`.

### Human Verification Required

None. This phase's scope (tools/list visibility, CLI-text-matching output, isError safety, colorless show/diff, live round-trip) was fully verifiable by direct source inspection, the full automated test suite (351 tests, all green), and live process spawning/probing of the real `git turn mcp` server over real stdio JSON-RPC — which is the strongest form of evidence available short of a third-party MCP client. Per the task's explicit guidance, registering with a real third-party MCP client (e.g. Claude Code) is deferred scope belonging to Phase 10 (VERIFY-04) and is not re-escalated here.

### Gaps Summary

No gaps found. All 5 ROADMAP success criteria and all 8 requirement IDs (MCP-04 through MCP-10, VERIFY-03) are verified against the actual codebase, not just SUMMARY.md claims:

- Read all 5 plan files and all 5 summary files, cross-checked against actual source.
- Read `src/mcp/server.js` and all 5 `src/mcp/tools/*.js` adapters in full.
- Read `src/commands/show.js`/`diff.js` color-override and tool_summary changes (via grep + prior review corroboration).
- Read `src/mcp/tools/roundtrip.test.js` in full — confirmed genuinely fixture-free, real-subprocess based.
- Spawned a real `git turn init` + real commits in a throwaway temp repo and confirmed the hook fires and writes a correct note.
- Spawned a real `git turn mcp` server process and sent live JSON-RPC `initialize`/`tools/list`/`tools/call` frames, independently confirming all 5 success criteria against live behavior, not just unit tests.
- Ran the full `npm test` suite (351 tests across all files) to completion: exit code 0.
- Cross-referenced REQUIREMENTS.md phase-9 traceability table against plan frontmatter `requirements:` fields — no orphans.

---

_Verified: 2026-11-01T21:24:00Z_
_Verifier: Claude (gsd-verifier)_
