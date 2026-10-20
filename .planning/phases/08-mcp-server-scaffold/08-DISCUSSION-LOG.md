# Phase 8: MCP Server Scaffold - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-20
**Phase:** 8-MCP Server Scaffold
**Areas discussed:** Startup feedback, cost --all display format, Shutdown behavior, Uninitialized-repo error wording

---

## Todo Fold (cross_reference_todos)

Three pending todos keyword-matched this phase. Initial multiSelect answer selected all three (cost --all no-op, stable change-identity research, mindwalk integration); Claude flagged that two of the three are open-ended research with no concrete implementation action fitting an "MCP server scaffold" phase. User's clarifying answer: fold only the cost --all fix.

| Todo | Folded? |
|------|---------|
| `2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` | ✓ — folded as COST-01 |
| `2026-09-17-mindwalk-integration.md` | Reviewed, not folded |
| `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` | Reviewed, not folded |

**User's choice:** "Just fix cost --all now, drop the other two (Recommended)"
**Notes:** Committed as `2c4a0be` (REQUIREMENTS.md, ROADMAP.md, STATE.md, todo frontmatter updated before this discussion continued).

---

## Startup feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, one line (Recommended) | `git turn mcp: server started, scoped to <repo-path>` on stderr after stdio connects — visible to a human, ignored by MCP clients | ✓ |
| Silent | No output at all on successful startup | |

**User's choice:** Yes, one line (Recommended)
**Notes:** None.

---

## cost --all display format

| Option | Description | Selected |
|--------|-------------|----------|
| Per-session blocks (Recommended) | Repeat today's single-session format once per session, grand total at the end | ✓ |
| One flat table, new Session column | Single interleaved table with a leftmost Session column | |

**User's choice:** Per-session blocks (Recommended)
**Notes:** None.

---

## Shutdown behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Silent exit (Recommended) | Exit code 0, no output | ✓ |
| One line on stderr | e.g. `git turn mcp: server stopped` before exiting | |

**User's choice:** Silent exit (Recommended)
**Notes:** None.

---

## Uninitialized-repo error wording

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse exact CLI text (Recommended) | `git turn: not initialized. Run \`git turn init\` first.` — identical string every other command uses | ✓ |
| MCP-specific wording | Something naming the server explicitly | |

**User's choice:** Reuse exact CLI text (Recommended)
**Notes:** None.

---

## Claude's Discretion

- Exact phrasing/formatting of the startup line and grand-total line beyond the illustrative examples given.
- Whether `src/mcp/server.js` is split from `src/commands/mcp.js` as a separate file — both valid per ARCHITECTURE.md's "optional split" framing.

## Deferred Ideas

- Claude Code Stop-hook for automatic `record-prompt` capture, possibly packaged as a Claude Code plugin — captured separately as `.planning/todos/pending/2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md`, explicitly independent of this milestone's read-direction MCP work.
