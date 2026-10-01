# Phase 6: Verification, Redact Command & Purge Procedure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-21
**Phase:** 6-Verification, Redact Command & Purge Procedure
**Areas discussed:** Redact scope, Confirmation behavior, Purge procedure exposure

---

## Redact scope

| Option | Description | Selected |
|--------|-------------|----------|
| Just the prompt text | Replace prompt with [REDACTED], leave model/usage/latency_ms/tool_summary intact | ✓ |
| Everything record-prompt added | Wipe prompt/model/usage/latency_ms/tool_summary entirely | |

**User's choice:** Just the prompt text
**Notes:** None.

---

## Confirmation behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Run immediately, no prompt | Matches revert/redo's existing style | ✓ |
| Require confirmation | Security-sensitive one-way operation, worth a safety check | |

**User's choice:** Run immediately, no prompt
**Notes:** None.

---

## Purge procedure exposure

| Option | Description | Selected |
|--------|-------------|----------|
| New git turn gc flag | e.g. `git turn gc --purge-notes` actually runs the sequence | ✓ |
| Documentation only | Write the exact git commands in README/AGENTS.md | |

**User's choice:** New git turn gc flag
**Notes:** None.

---

## Claude's Discretion

- Exact flag name for the purge command.
- Whether `redact <N>` accepts a session-scoped turn number, following show.js/diff.js conventions.
- `show.js`'s unconditional `--with-prompts` display (no flag gate, unlike log.js) — flagged, resolution left to planning/VERIFY-01 work.

## Deferred Ideas

None — discussion stayed within phase scope. `2026-09-07-rich-diff-renderer.md` and `2026-09-17-mindwalk-integration.md` were reviewed via keyword match but are unrelated; not folded.
