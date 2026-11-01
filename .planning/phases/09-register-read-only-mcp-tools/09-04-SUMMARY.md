---
phase: 09-register-read-only-mcp-tools
plan: 04
subsystem: mcp
tags: [mcp, zod, stdio-protocol, git-turn-server, agents-md]

# Dependency graph
requires:
  - phase: 09-02
    provides: "git_turn_log, git_turn_blame, git_turn_cost MCP tool adapters"
  - phase: 09-03
    provides: "git_turn_show, git_turn_diff MCP tool adapters"
provides:
  - "createServer() registers all 5 read-only MCP tools (git_turn_log/show/diff/blame/cost)"
  - "Real stdio tools/list / tools/call protocol coverage (tools/list schema shape, isError survival, FORCE_COLOR immunity, src/mcp purity)"
  - "AGENTS.md documents the 5 registered tools, their params, and the write-tool exclusion list"
affects: ["phase 10 (E2E verification with a real client)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createServer() wires each tool module via require('./tools/<name>').register(server) before returning the McpServer instance"
    - "stdio protocol tests use id-based request()/handshake() helpers that skip non-matching message ids, rather than assuming strict response ordering"

key-files:
  created: []
  modified:
    - src/mcp/server.js
    - src/commands/mcp.test.js
    - AGENTS.md

key-decisions:
  - "Restructured the AGENTS.md mcp-tools description into a bulleted list (one tool per line) instead of a single prose sentence, so each tool name sits on its own line — matches the plan's literal grep-based acceptance check (grep -c counts matching lines, not occurrences) while also improving readability"

patterns-established:
  - "N/A — wires together patterns already established by 09-02/09-03 adapters; no new architectural patterns introduced"

requirements-completed: [MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, MCP-09, MCP-10]

# Metrics
duration: 35min
completed: 2026-11-01
---

# Phase 9 Plan 4: Register Read-Only MCP Tools in createServer() Summary

**Wired all 5 read-only MCP tool adapters (git_turn_log/show/diff/blame/cost) into createServer(), added real stdio tools/list + tools/call protocol tests covering isError survival and FORCE_COLOR immunity, and updated AGENTS.md to describe them.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `createServer()` now requires `./tools/{log,show,diff,blame,cost}` and calls `register(server)` for each before returning the server instance — a real MCP client sees all 5 tools over stdio
- AGENTS.md's `git turn mcp` section replaced the "Registers zero tools" placeholder with a per-tool bulleted description (params, colorless show/diff behavior, isError semantics) and an explicit note that revert/bisect/redact/record-prompt are not exposed
- AGENTS.md's `git turn show` section documents the `Tool summary: Read:2, Edit:1`-style plain-text line
- New stdio protocol tests: `tools/list` returns exactly the 5 expected tool names with valid `inputSchema.type`/`required` fields; an out-of-range turn (999) returns `isError: true` with the CLI's exact error text and the server answers a subsequent `tools/call` without dying; invalid args (`turn: 'abc'`) still get a response and a following `tools/list` still works; `FORCE_COLOR=1` never leaks ANSI into `git_turn_show`/`git_turn_diff` output; a static purity check confirms no `process.exit`/`.run(` call and that every adapter requires a `commands/` module

## Task Commits

Each task was committed atomically:

1. **Task 1: Register all 5 tools in createServer() and document them in AGENTS.md** - `d348d1a` (feat)
2. **Task 2: stdio protocol tests — tools/list, isError survival, FORCE_COLOR immunity, src/mcp purity** - `3cf787b` (test)

## Files Created/Modified
- `src/mcp/server.js` - requires the 5 tool modules and calls `register(server)` for each inside `createServer()`
- `AGENTS.md` - documents the 5 registered MCP tools (params, isError/colorless semantics, excluded write tools) and the show-command `Tool summary` line
- `src/commands/mcp.test.js` - `spawnMcp`/`trackedSpawnMcp` now accept `extraEnv`; `repo` promoted to describe scope; new `handshake()`/`request()` helpers; 5 new protocol-level tests

## Decisions Made
- The plan's acceptance criterion `grep -c "git_turn_log\|git_turn_show\|..." AGENTS.md` outputs at least 5 only works if each tool name is on its own matched line (grep -c counts lines, not substring occurrences). Wrote the AGENTS.md mcp-tools description as a bulleted list (one tool per line) rather than one dense sentence, satisfying both the literal check and readability.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's `<action>` and `<behavior>` specifications; the only adjustment was the AGENTS.md formatting choice above, which is a documentation-presentation decision rather than a functional deviation.

## Issues Encountered

`npm test` (full suite, 27+ test files including the full `mcp.test.js` server-lifecycle/protocol suite) exceeded the foreground 120s timeout and was moved to background; confirmed completion with exit code 0 and all 12 `mcp.test.js` subtests passing via the background task output.

## Next Phase Readiness
- All 5 read-only MCP tools (`git_turn_log`, `git_turn_show`, `git_turn_diff`, `git_turn_blame`, `git_turn_cost`) are registered and reachable over real stdio `tools/list`/`tools/call`, satisfying Phase 9 success criteria 1, 3, and 4.
- Phase 10 (E2E verification with a real client) can proceed without further wiring work — `createServer()` is feature-complete for this milestone's tool surface.
- No blockers.

---
*Phase: 09-register-read-only-mcp-tools*
*Completed: 2026-11-01*

## Self-Check: PASSED

- FOUND: src/mcp/server.js
- FOUND: AGENTS.md
- FOUND: src/commands/mcp.test.js
- FOUND: .planning/phases/09-register-read-only-mcp-tools/09-04-SUMMARY.md
- FOUND commit: d348d1a (feat(09-04): register all 5 read-only MCP tools in createServer())
- FOUND commit: 3cf787b (test(09-04): stdio protocol tests for tools/list, isError survival, FORCE_COLOR immunity)
- FOUND commit: e80b041 (docs(09-04): add SUMMARY.md for register read-only MCP tools plan)
