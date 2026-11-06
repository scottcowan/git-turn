# Phase 10: End-to-End Verification with a Real MCP Client - Context

**Gathered:** 2026-11-06
**Status:** Ready for planning

<domain>
## Phase Boundary

A real MCP client (Claude Code) drives `git turn mcp`'s full read-only tool surface against real data, confirming the 5 tools work end-to-end and that tool errors recover gracefully without crashing the server or dropping the connection. This is the milestone's final verification phase — no new implementation, only proving what Phases 7-9 already built actually works against a real client (not the hand-written JSON-RPC harnesses Phases 8-9's own tests use).

</domain>

<decisions>
## Implementation Decisions

### Real client verification method
- **D-01:** Verification is a manual live check performed with this Claude Code session itself — register `git turn mcp` via `claude mcp add git-turn -- git turn mcp`, then literally call all 5 tools, trigger the two error scenarios (out-of-range turn number, uninitialized-repo condition), and confirm recovery. Not an automated test. Rationale: the installed `@modelcontextprotocol/server` package has no client API — only the heavier legacy `@modelcontextprotocol/sdk` ships one, and that package is explicitly out of scope per REQUIREMENTS.md's Out of Scope table, even as a devDependency.

### Target repo for the live check
- **D-02:** Point the live check at this git-turn project repo itself — real history, real turns already captured across Phases 7-9's execution. No disposable fixture repo setup needed.

### Phase artifact
- **D-03:** This phase produces no new source files. The live manual check's steps and results are documented directly in `10-VERIFICATION.md` (or a `10-HUMAN-UAT.md` if the verifier escalates per the standard human_needed protocol). No PLAN.md task touches `src/`.

### Claude's Discretion
- Exact phrasing/sequencing of the manual checklist steps (what order to call the 5 tools, which specific turn numbers to exercise) — any sequence that covers all 5 tools + both error scenarios + a post-error successful call satisfies the ROADMAP criteria.
- Whether the plan is a single tiny plan or zero plans with the checkpoint embedded directly — given D-03 (no code), the planner may determine this phase needs minimal or no PLAN.md structure beyond a verification checklist.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — VERIFY-04 (this phase's sole requirement), "Out of Scope" table (explicitly excludes `@modelcontextprotocol/sdk`)
- `.planning/ROADMAP.md` §"Phase 10: End-to-End Verification with a Real MCP Client" — the 3 success criteria this phase must satisfy

### What this phase verifies (built in prior phases, unchanged by this one)
- `src/commands/mcp.js`, `src/mcp/server.js` — the stdio server (Phase 8)
- `src/mcp/tools/{log,show,diff,blame,cost}.js` — the 5 registered tools (Phase 9)
- `.planning/phases/09-register-read-only-mcp-tools/09-VERIFICATION.md` — Phase 9's verifier already did a live stdio probe (hand-written JSON-RPC, not a real client) confirming `tools/list`, `isError` recovery, and FORCE_COLOR immunity all work correctly at the protocol level — Phase 10's job is confirming the same behavior through an actual MCP client's own negotiation path, which Phase 9 explicitly deferred

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None needed — no code changes in this phase (D-03).

### Established Patterns
- `claude mcp add <name> -- <command>` is the standard way to register a local stdio MCP server with Claude Code.

### Integration Points
- None — this phase only exercises the existing `git turn mcp` binary as a black box through a real client.

</code_context>

<specifics>
## Specific Ideas

No particular script beyond: call all 5 tools once each, trigger an out-of-range turn number, trigger an uninitialized-repo check (likely via a throwaway separate directory, since the project repo itself is always initialized — Claude's discretion on exact mechanics), then confirm one more successful tool call in the same session after the error.

</specifics>

<deferred>
## Deferred Ideas

None new from this discussion.

### Reviewed Todos (not folded)
- `2026-11-01-git-turn-install-global-hook-via-init-templatedir.md` [cli] — new CLI feature, unrelated to E2E verification.
- `2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` [cli] — already shipped as COST-01 in Phase 8; stale todo, should be auto-closed as bookkeeping, not phase work.
- `2026-09-17-mindwalk-integration.md` [integration] — open-ended research, not implementation-ready.
- `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` [research] — open-ended research, not implementation-ready.
- `2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md` [integration] — write-direction, unrelated to this phase's read-only verification.

</deferred>

---

*Phase: 10-End-to-End Verification with a Real MCP Client*
*Context gathered: 2026-11-06*
