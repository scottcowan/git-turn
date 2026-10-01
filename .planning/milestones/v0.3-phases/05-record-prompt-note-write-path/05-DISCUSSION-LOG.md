# Phase 5: record-prompt Note-Write Path - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-18
**Phase:** 5-record-prompt Note-Write Path
**Areas discussed:** Input shape, Target turn resolution, Re-call/merge behavior, Tool-call summary format

---

## Input shape

| Option | Description | Selected |
|--------|-------------|----------|
| CLI flags | --prompt, --model, --usage-json, --latency-ms, --tool-summary-json | |
| JSON via stdin | Single JSON blob piped in | ✓ |

**User's choice:** JSON via stdin (after a clarifying round)
**Notes:** User's first answer was "through hooks" — a statement about *who* calls the command, not the literal input mechanism. Follow-up question clarified that a hook naturally has a structured JSON payload already, so stdin JSON avoids the hook needing to serialize into flags. User confirmed stdin JSON on the follow-up.

---

## Target turn resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Always the latest turn in the current session | No turn argument needed | ✓ |
| Optional --turn N override | Defaults to latest, allows targeting an older turn | |

**User's choice:** Always the latest turn in the current session
**Notes:** None.

---

## Re-call behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Merge — later call adds/overwrites only the fields it provides | Matches read-merge-write design, supports incremental capture | ✓ |
| Refuse if already has prompt data | Safer against double-calls, blocks incremental capture | |

**User's choice:** Merge
**Notes:** None.

---

## Tool-call summary format

| Option | Description | Selected |
|--------|-------------|----------|
| Per-tool breakdown | e.g. {Read: 5, Edit: 2, Bash: 1} | ✓ |
| Total count only | e.g. tool_call_count: 8 | |

**User's choice:** Per-tool breakdown
**Notes:** None.

---

## Claude's Discretion

- Exact retry-on-conflict strategy for the read-merge-write race — follow architecture research's `updateNote(ref, sha, patchFn)` helper pattern.
- Malformed JSON stdin handling — fail loudly, never silently drop data.
- SQLite cache schema migration mechanics — implementation detail per architecture research.

## Deferred Ideas

- Claude Code Stop-hook wrapper script (constructs and pipes the JSON payload) — out of scope for this phase, already tracked as a Future Requirement.
- `2026-09-07-rich-diff-renderer.md` and `2026-09-17-mindwalk-integration.md` — matched by keyword search but unrelated to this phase's scope; reviewed, not folded.
