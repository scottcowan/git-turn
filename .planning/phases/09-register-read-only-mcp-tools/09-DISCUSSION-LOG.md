# Phase 9: Register Read-Only MCP Tools - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-01
**Phase:** 9-Register Read-Only MCP Tools
**Areas discussed:** Tool description verbosity, Color forcing for show/diff (MCP-10), MCP parameter naming, compute() calling convention

---

## Todo Fold (cross_reference_todos)

5 pending todos keyword-matched this phase on generic terms ("git turn", "repo", "hook", "tool"). None were genuinely implementation-ready matches for "register 5 read-only MCP tools."

| Todo | Folded? |
|------|---------|
| `2026-10-08-cost-all-flag-is-parsed-but-never-applied.md` | Reviewed, not folded — already shipped as COST-01 in Phase 8; flagged as a stale bookkeeping entry, not new work |
| `2026-11-01-git-turn-install-global-hook-via-init-templatedir.md` | Reviewed, not folded — unrelated CLI feature |
| `2026-09-17-mindwalk-integration.md` | Reviewed, not folded — open-ended research |
| `2026-10-07-explore-stable-change-identity-beyond-sha-anchoring.md` | Reviewed, not folded — open-ended research |
| `2026-10-16-claude-code-stop-hook-for-auto-record-prompt-capture.md` | Reviewed, not folded — write-direction, unrelated |

**User's choice:** "Leave all in backlog (Recommended)"
**Notes:** None.

---

## Tool description verbosity

| Option | Description | Selected |
|--------|-------------|----------|
| Concise one-liner + key constraints (Recommended) | Names every parameter, short enough for fast LLM reading | ✓ |
| Minimal (mirrors --help text verbatim) | Zero new copy, but doesn't name parameters | |
| Detailed with examples | Most guidance, 5x more copy to maintain | |

**User's choice:** Concise one-liner + key constraints (Recommended)
**Notes:** None.

---

## Color forcing for show/diff (MCP-10)

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit color:false override (Recommended) | Bypasses shouldColor()'s FORCE_COLOR/isTTY check entirely | ✓ |
| Rely on non-TTY detection | No code change, but FORCE_COLOR env var could still leak ANSI | |

**User's choice:** Explicit color:false override (Recommended)
**Notes:** None.

---

## MCP parameter naming

| Option | Description | Selected |
|--------|-------------|----------|
| camelCase, matching ARCHITECTURE.md's example (Recommended) | withPrompts, noCache, turn, toTurn | ✓ |
| Mirror CLI flag names directly | with_prompts, no_cache (snake_case) | |

**User's choice:** camelCase, matching ARCHITECTURE.md's example (Recommended)
**Notes:** None.

---

## compute() calling convention

| Option | Description | Selected |
|--------|-------------|----------|
| Keep argv-array reconstruction (Recommended) | Zero changes to the 5 command files beyond D-02's color override | ✓ |
| Add an options-object parameter | Cleaner call sites, but touches all 5 files, diverges from "one parsing contract" | |

**User's choice:** Keep argv-array reconstruction (Recommended)
**Notes:** None.

---

## Claude's Discretion

- Exact field/param ordering within each tool's zod schema beyond the locked names.
- Exact wording of each tool's one-line description beyond "name every parameter."

## Deferred Ideas

None — discussion stayed within phase scope. Five pending todos were reviewed during cross-referencing and explicitly left in the backlog (see Todo Fold above).
