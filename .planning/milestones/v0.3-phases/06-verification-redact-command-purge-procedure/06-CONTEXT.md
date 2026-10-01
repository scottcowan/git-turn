# Phase 6: Verification, Redact Command & Purge Procedure - Context

**Gathered:** 2026-09-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Three deliverables: (1) end-to-end verification that `log`/`show --with-prompts` and `cost` render/price real captured data correctly now that Phase 5 produces it (VERIFY-01, VERIFY-02); (2) `git turn redact <N>` — a post-hoc command to scrub a specific turn's note after the fact (REDACT-02); (3) a real, runnable purge procedure for removing an already-written secret blob from `refs/notes/git-turn` history, since neither `git filter-repo` nor BFG cover this ref namespace (REDACT-03).

</domain>

<decisions>
## Implementation Decisions

### Redact scope
- **D-01:** `git turn redact <N>` scrubs only the `prompt` field, replacing it with `[REDACTED]` (or clearing it). `model`/`usage`/`latency_ms`/`tool_summary` are left intact — those fields are structured/enumerable, not freeform text, so they're not where a leaked secret would realistically live (same reasoning already applied in Phase 5's `redact()` call-site scoping).

### Confirmation behavior
- **D-02:** Runs immediately, no confirmation prompt — consistent with git-turn's existing mutating commands (`revert`, `redo`), which don't ask for confirmation today.

### Purge procedure exposure
- **D-03:** REDACT-03 ships as a real CLI flag, not documentation-only: `git turn gc --purge-notes` (or similar flag name, planner's call on exact naming) actually runs the reflog-expire + `git gc --prune=now` sequence scoped to `refs/notes/git-turn`. Consistent with `gc.js`'s existing pattern (`--rebuild` already triggers a real cache rebuild, not just a doc pointer).

### Claude's Discretion
- Exact flag name for the purge command (`--purge-notes` vs alternatives) — planner's call, should read naturally in `--help` output.
- Whether `redact <N>` accepts a session-scoped turn number or requires session context like other commands (`show`, `diff`) already do — follow whatever convention `show.js`/`diff.js` already use for resolving `<N>` within the current session.
- `show.js`'s `--with-prompts` gating: `log.js` already gates prompt display behind `--with-prompts`, but `show.js` currently displays `meta.prompt` unconditionally (no flag gate). This inconsistency was flagged as an open question in Phase 5's architecture research and never resolved — VERIFY-01's "end-to-end verification" work in this phase is a natural place to decide and fix it, but it's an implementation detail, not a user-facing decision to make here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — storage model, Phase 4/5 completion notes
- `.planning/REQUIREMENTS.md` — REDACT-02, REDACT-03, VERIFY-01, VERIFY-02 (this phase's mapped requirements)
- `.planning/ROADMAP.md` §Phase 6 — goal, success criteria, dependency on Phase 5

### Research (milestone-level, still applicable)
- `.planning/research/PITFALLS.md` — Pitfall 2/3: `git filter-repo`/BFG have zero documented handling of notes refs; overwriting/redacting a note does not delete the prior blob until an explicit reflog-expire + `gc --prune=now` — this is the exact mechanism `redact <N>` (D-01) and the purge procedure (D-03) must account for. Redacting a note is necessary but not sufficient; the purge command is what actually removes the old blob.
- `.planning/research/ARCHITECTURE.md` — confirms `cost.js` already degrades gracefully on missing/malformed `usage` fields (validate-light philosophy, already applied in Phase 5); VERIFY-02's job is to prove this works end-to-end with real data, not to add new validation.

### Phase 4/5 (dependencies)
- `src/redact.js` — the scanner; `redact <N>` likely reuses this same function (or a simpler direct clear) on the existing prompt field
- `src/git.js` — `updateNote(ref, sha, patchFn)` (Phase 5) — the merge-write primitive `redact <N>` should use to clear the `prompt` field without touching other fields, consistent with the read-merge-write discipline already established
- `src/commands/record-prompt.js` — the writer this phase's remediation command is undoing; read for the exact note-field shape being redacted
- `.planning/phases/05-record-prompt-note-write-path/05-RESEARCH.md` — open question about `show.js`'s unconditional prompt display (see Claude's Discretion above)

### Existing code (verified this session)
- `src/commands/gc.js` — existing `--rebuild` flag pattern (real action, not just a message) — the analog for adding `--purge-notes`
- `src/commands/log.js:14,33,67` — `--with-prompts` flag gate already implemented on the read side
- `src/commands/show.js` — displays `meta.prompt` with no flag gate (inconsistency noted above)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `updateNote()` in `src/git.js` — reuse for `redact <N>`'s note write
- `redact()` in `src/redact.js` — reuse if `redact <N>` re-scans rather than blanket-clears the prompt field (planner's call)
- `gc.js`'s existing `--rebuild` flag-dispatch pattern — direct analog for `--purge-notes`

### Established Patterns
- Zero-npm-dependency discipline — no new packages; the purge procedure is just `git reflog expire` + `git gc --prune=now` shelled out via `execFile`, same pattern as every other git-turn git call
- `'use strict'`, plain functions, single `module.exports`, `node:test` fixture style

### Integration Points
- `src/commands/redact.js` (new) — likely command
- `src/commands/gc.js` (modified) — add `--purge-notes` flag
- `bin/git-turn` — register `redact` command
- `src/commands/log.test.js`/`show.test.js`/`cost.test.js` — end-to-end tests against real `record-prompt`-written data (VERIFY-01/02)

</code_context>

<specifics>
## Specific Ideas

No UI/visual requirements. The three decisions above (prompt-only scrub, no confirmation, real purge command) are the concrete shape.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)
- `2026-09-07-rich-diff-renderer.md` — keyword-matched (score 0.6) but unrelated (diff rendering, not redaction/verification); not folded.
- `2026-09-17-mindwalk-integration.md` — keyword-matched (score 0.4) but unrelated (external tool integration exploration); not folded.

</deferred>

---

*Phase: 6-Verification, Redact Command & Purge Procedure*
*Context gathered: 2026-09-21*
