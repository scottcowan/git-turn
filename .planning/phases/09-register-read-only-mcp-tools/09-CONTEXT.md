# Phase 9: Register Read-Only MCP Tools - Context

**Gathered:** 2026-11-01
**Status:** Ready for planning

<domain>
## Phase Boundary

An MCP client sees and can successfully call all 5 read-only git-turn tools (`git_turn_log`, `_show`, `_diff`, `_blame`, `_cost`) registered on the Phase 8 scaffold's zero-tool `McpServer`, with output text matching the CLI and errors surfaced as recoverable `isError: true` results rather than server crashes. Write/destructive tools (`revert`/`bisect`/`redact`/`record-prompt`) are explicitly out of scope — tracked separately in REQUIREMENTS.md's Future Requirements.

</domain>

<decisions>
## Implementation Decisions

### Tool description verbosity
- **D-01:** Each tool's `description` field is a concise one-liner naming every parameter — e.g. `"List turns in the current session (mirrors \`git turn log\`). Supports withPrompts/noCache."` — short enough for fast LLM-client reading, but complete enough that the client doesn't have to guess at available parameters.

### Color forcing for git_turn_show/git_turn_diff (MCP-10)
- **D-02:** Tool handlers for `git_turn_show`/`git_turn_diff` pass an explicit color-off override that bypasses `shouldColor()`'s `FORCE_COLOR`/`isTTY` check entirely, rather than relying on stdout-never-being-a-TTY as sufficient. This guards against the MCP server process inheriting `FORCE_COLOR=1` from its launching shell and leaking ANSI codes into tool output. Implementation detail (exact param name/shape on `compute()`) is planner's call, but the behavior must be unconditional, not environment-dependent.

### MCP parameter naming
- **D-03:** All 5 tools' zod input schemas use camelCase parameter names matching the milestone ARCHITECTURE.md's own Pattern 2 example: `withPrompts`, `noCache`, `turn`, `toTurn` (for `git_turn_diff`'s optional second turn number), `all` (for `git_turn_cost --all`). Not snake_case, not a literal mirror of the CLI's kebab-case flag spelling.

### compute() calling convention
- **D-04:** Tool handlers reconstruct a CLI-flag-shaped argv array (e.g. `[withPrompts && '--with-prompts', noCache && '--no-cache'].filter(Boolean)`) and call the existing `compute(args)` functions unchanged — per the milestone ARCHITECTURE.md's explicit rationale ("one parsing contract, two callers"). No new options-object parameter is added to any of the 5 command files. The only signature change permitted is D-02's color-off override.

### Claude's Discretion
- Exact field/param ordering within each tool's zod schema beyond the names locked in D-03.
- Whether `src/mcp/tools/*.js` is one file per tool (matching the milestone ARCHITECTURE.md's recommended structure) — already effectively locked by that research, not re-litigated here.
- Exact wording of each tool's one-line description beyond D-01's "name every parameter" constraint.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & pitfalls (milestone-level research, locks most structural decisions)
- `.planning/research/ARCHITECTURE.md` — Pattern 2 (MCP tool adapter = thin wrapper around `compute()`, with a full worked `git_turn_log` example showing the argv-reconstruction + `isError` pattern this phase must follow verbatim), Build Order Phase C acceptance checks (`grep -r process.exit src/mcp/` returns nothing; each tool has a success-path test and a thrown-`Error`→`isError:true` test)
- `.planning/research/PITFALLS.md` — Pitfall 5 (snapshot-sha-vs-HEAD-sha notes lookup bug class, already fixed in `log.js`/`show.js`/`cost.js` via `parseSnapshotMessage(sha).headSha` — tool handlers calling `compute()` inherit this fix automatically since they never touch sha resolution directly; do not let a new MCP-specific helper re-derive it)

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — MCP-04 through MCP-10 (this phase's tool requirements), VERIFY-03 (live round-trip test, also this phase)
- `.planning/ROADMAP.md` §"Phase 9: Register Read-Only MCP Tools" — the 5 success criteria this phase must satisfy

### Phase 8 scaffold (what this phase builds on top of)
- `src/mcp/server.js` — `createServer()` factory; this phase adds `server.registerTool(...)` calls here (comment already marks the spot)
- `src/commands/mcp.js` — process lifecycle (unchanged by this phase)
- `.planning/phases/08-mcp-server-scaffold/08-SUMMARY.md` files — what Phase 8 actually shipped

### Prior phase decisions carried forward
- `.planning/phases/07-compute-run-split-cli-json-output/07-CONTEXT.md` D-06/D-07 — `--json` output shape principles (not directly reused by MCP tools, which return the CLI's formatted text per ARCHITECTURE.md's explicit anti-pattern warning against building a parallel structured API — but useful background on why text-mirroring, not JSON, is this phase's contract)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `compute(args, opts = {})` already exists, exported, on all 5 command files (`log.js`, `show.js`, `diff.js`, `blame.js`, `cost.js`) — confirmed this session by reading each file's `module.exports`. Every tool handler calls one of these directly.
- `src/mcp/server.js`'s `createServer()` — the exact insertion point for `registerTool()` calls, already commented.

### Established Patterns
- `shouldColor()` in `src/git.js` — currently the only color decision point for `diff`/`show`; D-02 requires adding an override path here or in `diff.js`/`show.js`'s `compute()`.
- One-file-per-command convention (`src/commands/*.js`) has a parallel in `src/mcp/tools/*.js` per ARCHITECTURE.md's recommended structure — mirrors, doesn't duplicate.

### Integration Points
- `src/mcp/server.js` ↔ `src/mcp/tools/*.js` (new) — `server.js`'s `createServer()` calls each tool module's `register(server)` function.
- `src/mcp/tools/*.js` ↔ `src/commands/*.js` — one-directional `require()`, calling `compute()` only, never `run()` (ARCHITECTURE.md Anti-Pattern 2).

</code_context>

<specifics>
## Specific Ideas

No particular wording/example beyond the decisions above — ARCHITECTURE.md's Pattern 2 worked example (`git_turn_log` tool) is the concrete template to follow for the other 4 tools.

</specifics>

<deferred>
## Deferred Ideas

None new from this discussion.

### Reviewed Todos (not folded)
- `2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` [cli] — already shipped as COST-01 in Phase 8; this todo file appears stale and should be auto-closed as a bookkeeping cleanup, not folded as new Phase 9 work.
- `2026-11-01-git-turn-install-global-hook-via-init-templatedir.md` [cli] — new CLI feature (auto-init via `init.templateDir`), unrelated to registering MCP tools.
- `2026-09-17-mindwalk-integration.md` [integration] — open-ended research, not implementation-ready.
- `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` [research] — open-ended research, not implementation-ready.
- `2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md` [integration] — write-direction counterpart to the MCP server; unrelated to this phase's read-only tool registration.

</deferred>

---

*Phase: 9-Register Read-Only MCP Tools*
*Context gathered: 2026-11-01*
