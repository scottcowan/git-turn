# Requirements: v0.4 MCP Server

**Defined:** 2026-10-07
**Core Value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Prerequisite Refactor

- [x] **REFACTOR-01**: `log`/`show`/`diff`/`blame`/`cost` each export a `compute(args)` function that returns a string (or `Promise<string>` for `cost`) and throws `Error` on failure, with the existing `run(args)` reduced to a thin CLI wrapper around it — CLI-visible output and exit codes are byte-identical before and after the refactor **when run with `--plain`** (see DIFF-01, which changes the unflagged default)

### Rich Diff Rendering

- [x] **DIFF-01**: `diff`/`show` render a richer full-line-highlight format by default (full-row ANSI background per added/removed line, a line-number gutter, and an "Added N / removed M" summary header), replacing today's foreground-only `git diff --color=always` passthrough as the default; a `--plain` flag restores the exact current plain-text/foreground-color format byte-for-byte (this is what REFACTOR-01's byte-identical acceptance criterion is verified against)

### Bug Fixes

- [ ] **COST-01**: `git turn cost --all` actually reports across all sessions (not just the current one), using `blame-util.js`'s existing `listAllTurns({ noCache })` cross-session helper (the same pattern `blame`/`bisect`/`heatmap` already use) instead of the single-session `listTurns()` call — fixes a pre-existing no-op where `--all` was parsed but never applied

### MCP Server Infrastructure

- [ ] **MCP-01**: `git turn mcp` starts a stdio MCP server implementing `initialize` / `notifications/initialized` / `tools/list` / `tools/call`, scoped to the cwd's repo (same scoping model as every other `git turn` command)
- [ ] **MCP-02**: The server validates at startup that cwd is a git-turn-initialized repo, failing loudly on stderr if not, and never re-reads cwd per tool call
- [ ] **MCP-03**: The server stays alive until its stdio stream closes and exits cleanly on stdin-close or SIGINT

### MCP Tools (read-only)

- [ ] **MCP-04**: `git_turn_log` tool mirrors `git turn log`'s output as text content (supports `with_prompts`/`no_cache` equivalents)
- [ ] **MCP-05**: `git_turn_show` tool mirrors `git turn show <N>`'s output as text content, including the `tool_summary` field when present on the turn's note
- [ ] **MCP-06**: `git_turn_diff` tool mirrors `git turn diff <N> [M]`'s output as text content
- [ ] **MCP-07**: `git_turn_blame` tool mirrors `git turn blame <file>`'s output as text content
- [ ] **MCP-08**: `git_turn_cost` tool mirrors `git turn cost [--all]`'s output as text content
- [ ] **MCP-09**: Any error during a tool call (bad turn number, uninitialized repo, etc.) surfaces as an `isError: true` tool result carrying the same message text the CLI prints — never a thrown exception or `process.exit` that would kill the server
- [ ] **MCP-10**: `show`/`diff` output is forced color-off in the MCP path regardless of TTY heuristics (an MCP client is never a TTY)

### CLI JSON Output

- [x] **JSON-01**: A CLI-wide `--json` flag is available on `log`/`show`/`diff`/`blame`/`cost`, emitting structured JSON instead of formatted text — groundwork for future MCP `structuredContent`, and useful for scripts/CI independent of MCP

### Verification

- [ ] **VERIFY-03**: A live round-trip test (a real hook-written note read back through each MCP tool, not hand-built fixtures) proves the snapshot-sha-vs-HEAD-sha notes lookup bug class — already shipped and fixed twice (v0.2, v0.3) — does not regress a third time
- [ ] **VERIFY-04**: A real MCP client (Claude Code) exercises all 5 tools against a real session with real turns; an out-of-range turn number or uninitialized-repo error surfaces as a recoverable tool error (not a server crash), and a subsequent unrelated tool call still succeeds in the same session

## Future Requirements

Deferred to future releases. Tracked but not in this roadmap.

### MCP (write/destructive)

- **MCP-REVERT**: `git_turn_revert` as an MCP tool — deferred until an MCP confirmation/elicitation pattern exists in this codebase
- **MCP-BISECT**: `git_turn_bisect` as an MCP tool — write-adjacent (runs arbitrary caller-supplied commands), same confirmation-pattern blocker
- **MCP-REDACT**: `git_turn_redact` as an MCP tool — destructive, same blocker
- **MCP-RECORD-PROMPT**: `git_turn_record_prompt` as an MCP tool — write path, same blocker

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Pagination/filtering params beyond what the CLI itself supports | MCP surface must never get ahead of the CLI surface it mirrors |
| Multi-repo / persistent server reuse across cwd changes | No existing state model supports this; one `git turn mcp` process per repo is the normal stdio-MCP-server pattern |
| HTTP/SSE transport for the MCP server | This milestone is stdio-only; local MCP clients (Claude Code) launch the server as a subprocess over stdio |
| `@modelcontextprotocol/sdk` (legacy monolithic package) | Superseded by `@modelcontextprotocol/server` + `zod`, which depends on far fewer transitive packages for the same stdio+tools surface |
| Hand-rolled JSON-RPC/MCP protocol implementation | Initially considered (zero-dependency posture) but rejected — hand-rolling the full capability-negotiation handshake is materially larger scope than the project's "vendored, not borrowed" precedent (`src/redact.js`) was meant to cover |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| REFACTOR-01 | Phase 7 | Complete |
| DIFF-01 | Phase 7 | Complete |
| COST-01 | Phase 8 | Pending |
| MCP-01 | Phase 8 | Pending |
| MCP-02 | Phase 8 | Pending |
| MCP-03 | Phase 8 | Pending |
| MCP-04 | Phase 9 | Pending |
| MCP-05 | Phase 9 | Pending |
| MCP-06 | Phase 9 | Pending |
| MCP-07 | Phase 9 | Pending |
| MCP-08 | Phase 9 | Pending |
| MCP-09 | Phase 9 | Pending |
| MCP-10 | Phase 9 | Pending |
| JSON-01 | Phase 7 | Complete |
| VERIFY-03 | Phase 9 | Pending |
| VERIFY-04 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-10-07*
*Last updated: 2026-10-14 after folding COST-01 (cost --all fix) into Phase 8 during discuss-phase*
