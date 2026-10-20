# Phase 8: MCP Server Scaffold - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning

<domain>
## Phase Boundary

`git turn mcp` starts a long-running stdio MCP server, correctly scoped (once, at startup) to the invoking repo, with zero tools registered yet. Also fixes a pre-existing, unrelated bug: `cost --all` is parsed but never applied (COST-01). Registering the five read-only tools themselves is Phase 9 — out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Startup feedback
- **D-01:** On successful startup (after the stdio transport connects), `git turn mcp` prints one line to stderr, e.g. `git turn mcp: server started, scoped to <repo-path>`. This is for a human testing it manually in a terminal — MCP clients only read stdout for JSON-RPC and ignore stderr, so this is safe to always print.

### Shutdown behavior
- **D-02:** On clean shutdown (stdin closes, or SIGINT), the server exits silently — no stderr message, exit code 0. No symmetry requirement with the startup message; chosen to avoid any risk of a stray write racing stdio teardown.

### Uninitialized-repo error wording (MCP-02)
- **D-03:** Reuse the exact existing CLI string verbatim: `git turn: not initialized. Run \`git turn init\` first.` — the same text `readSession()` returning null already produces in cost.js/status.js/etc. No new error string to introduce or keep in sync.

### cost --all display format (COST-01)
- **D-04:** Plain-text `cost --all` output repeats today's single-session format (header `Session: <id>` + table + per-session subtotal) once per session, in turn order — minimal diff to the existing renderer in `src/commands/cost.js`, just loop it across `listAllTurns({ noCache })`'s sessions instead of `listTurns()`'s single session. A grand total across all sessions prints at the very end, after the last per-session block. `--json` already carries `session_id` per turn regardless of this choice (Phase 7 already shipped that shape) — this decision only affects the plain-text renderer.

### Claude's Discretion
- Exact phrasing/formatting of the D-01 startup line and the grand-total line in D-04 (beyond the examples given) — these are implementation detail, not locked to the literal example text.
- Whether `src/mcp/server.js` is split from `src/commands/mcp.js` as its own file (per ARCHITECTURE.md's "optional split") — defer to planner/executor judgment; both are equally valid per research.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & pitfalls (already-completed research, locks most structural decisions)
- `.planning/research/ARCHITECTURE.md` — system overview, recommended `src/mcp/` + `src/commands/mcp.js` structure, Build Order Phase A (done, Phase 7)/B (this phase)/C (Phase 9)/D (Phase 10), the `@modelcontextprotocol/server`+`zod` dependency choice and rationale
- `.planning/research/PITFALLS.md` — Pitfall 3 (process.exit reachable from a tool handler kills the server — N/A directly to Phase 8 since no tools are registered yet, but applies to `mcp.js`/`server.js` bootstrap code itself), Pitfall 4 (cwd/repo-scoping drift — directly governs this phase: capture cwd once at startup, validate once, fail loudly on stderr, never re-read per call)
- `.planning/research/STACK.md` — dependency verification (`@modelcontextprotocol/server@2.3.1` + `zod@4.6.5`, CJS/ESM dual export, peer requirement `^4.2.0`)

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — MCP-01, MCP-02, MCP-03 (server infra requirements this phase delivers), COST-01 (bug fix folded into this phase)
- `.planning/ROADMAP.md` §"Phase 8: MCP Server Scaffold" — the 5 success criteria this phase must satisfy

### Pre-existing bug being fixed (COST-01)
- `.planning/todos/pending/2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` — original bug report
- `src/commands/cost.js` — target file; `allSessions` parsed at line ~87 but never used; `listTurns()` called instead of a cross-session helper
- `src/blame-util.js` — `listAllTurns({ noCache })`, the existing cross-session helper (already used identically by `blame.js:34`, `bisect.js:53`, `heatmap.js:330`); COST-01 should reuse this verbatim, not reinvent cross-session enumeration

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/blame-util.js`'s `listAllTurns({ noCache })` — cross-session turn enumeration, already proven by `blame`/`bisect`/`heatmap`; COST-01 wires this into `cost.js`'s `--all` branch in place of `listTurns()`.
- `bin/git-turn`'s existing promise-aware dispatch branch (`if (result && typeof result.then === 'function') result.catch(...)`) — written for `cost.js`'s async pricing fetch, works unmodified for `mcp.js`'s `run(args)` returning the long-lived `server.connect(transport)` promise. No change needed to `bin/git-turn` beyond adding `'mcp'` to `COMMANDS` and a `--help` line.
- `src/commands/status.js`'s `readSession()` → null → `'git turn: not initialized. Run \`git turn init\` first.'` pattern — exact reuse target for D-03.

### Established Patterns
- compute()/run() split (Phase 7, already shipped) — `log`/`show`/`diff`/`blame`/`cost` all export both; `mcp.js`'s bootstrap code itself must follow the same discipline (no `process.exit()` reachable once tools are added in Phase 9, even though Phase 8 registers none yet — the scaffold code paths executors write now are what Phase 9's tool handlers will run inside).
- One-file-per-command convention under `src/commands/` — `mcp.js` is a new sibling, structurally identical in role to `log.js`/`cost.js` etc. from `bin/git-turn`'s point of view.

### Integration Points
- `src/mcp/server.js` ↔ `src/commands/mcp.js` — factory/CLI-shell split per ARCHITECTURE.md (optional, Claude's discretion per decisions above).
- `src/commands/mcp.js` ↔ `bin/git-turn` — unmodified dispatch mechanism, `COMMANDS` array + `--help` text gain one line each.
- `cost.js`'s existing table-building loop (`lines.push(...)` per turn) — COST-01 wraps this in an outer per-session loop per D-04, rather than restructuring the inner per-turn formatting.

</code_context>

<specifics>
## Specific Ideas

No particular visual/wording mockups beyond the D-01/D-02/D-03/D-04 decisions above and their illustrative example strings.

</specifics>

<deferred>
## Deferred Ideas

- Claude Code Stop-hook for automatic `record-prompt` capture (and possibly packaging as a distributable Claude Code plugin) — write-direction counterpart to this milestone's read-direction MCP work; captured as its own todo (`.planning/todos/pending/2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md`), not part of any current phase.

### Reviewed Todos (not folded)
- `2026-09-17-mindwalk-integration.md` [integration] — open-ended research exploring turn-boundary markers for mindwalk's session replay; reviewed during `cross_reference_todos` but declined — no concrete implementation action that fits a phase whose deliverable is "server starts/stays alive/exits cleanly."
- `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` [research] — inspired by Delta/DeltaDB's stable change-identity model; reviewed and declined for the same reason — open-ended research, not implementation-ready, unrelated to the MCP scaffold.

</deferred>

---

*Phase: 8-MCP Server Scaffold*
*Context gathered: 2026-10-20*
