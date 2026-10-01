# Phase 5: record-prompt Note-Write Path - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning

<domain>
## Phase Boundary

`git turn record-prompt` — a new writer command that attaches prompt/model/usage/latency/tool-summary metadata to the current turn's note, via safe read-merge-write, without clobbering the post-commit hook's existing fields (`session_id`/`turn_n`/`snapshot_sha`/`ts`). All content passed to it is redacted through Phase 4's `src/redact.js` scanner before the note is written. This phase delivers the writer and its integration with the existing note/cache architecture — it does not deliver the caller (a Claude Code hook wrapper is a separate future phase/fast-follow, out of scope here).

</domain>

<decisions>
## Implementation Decisions

### Input shape
- **D-01:** `record-prompt` reads a single JSON blob from stdin (e.g. `echo '{...}' | git turn record-prompt`), not CLI flags. Rationale: this command will primarily be invoked from a hook (e.g. a future Claude Code Stop-hook wrapper), and a hook already has a structured JSON payload — reading it directly avoids the hook script having to serialize its own data into flags. Expected JSON shape: `{ prompt, model, usage, latency_ms, tool_summary }` — all fields optional (partial payloads are valid, per D-03's merge semantics).

### Target turn resolution
- **D-02:** Always targets the latest turn in the current session — no `--turn N` override. Resolved via `listTurns(sessionId)` + `parseSnapshotMessage()` (per Phase 4/milestone architecture research), never bare `HEAD`. Simplest call pattern: invoked right after a commit, targeting that commit's turn.

### Re-call / merge semantics
- **D-03:** Calling `record-prompt` more than once for the same turn merges — a later call adds/overwrites only the fields it provides, leaving previously-written fields (from the hook or an earlier `record-prompt` call) intact. This is the same read-merge-write contract already required to protect the hook's own fields (`session_id`/`turn_n`/`snapshot_sha`/`ts`), extended to also apply between multiple `record-prompt` calls — not a new mechanism, the natural consequence of "always read-merge-write, never blind-overwrite." Supports incremental capture (e.g. prompt now, usage/latency later once available).

### Tool-call summary format
- **D-04:** Per-tool breakdown, not a total-count-only number. Shape: an object mapping tool name to call count, e.g. `{"Read": 5, "Edit": 2, "Bash": 1}`. Total count is trivially derivable by summing values; the breakdown is more useful for understanding what an agent actually did during a turn.

### Claude's Discretion
- Exact retry-on-conflict strategy for the read-merge-write race against the post-commit hook (research already recommends this; planner should follow the architecture research's `updateNote(ref, sha, patchFn)` helper pattern) — implementation detail, not user-facing.
- Whether the JSON stdin parse failure mode (malformed JSON) exits with an error or a specific message — planner's call, should just fail loudly (never silently drop data).
- SQLite cache schema migration mechanics (`usage` column, `tool_summary` column, guarded `ALTER TABLE`) — implementation detail per architecture research.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` — storage model, zero-npm-dependency constraint, Phase 4 completion note (redaction scanner shipped, not yet wired into a writer)
- `.planning/REQUIREMENTS.md` — CAPTURE-01, CAPTURE-02, CAPTURE-03, CAPTURE-04 (this phase's mapped requirements)
- `.planning/ROADMAP.md` §Phase 5 — goal, success criteria, dependency on Phase 4

### Research (this milestone)
- `.planning/research/ARCHITECTURE.md` — the authoritative integration design: read-merge-write via a single `updateNote(ref, sha, patchFn)` helper (never a second note, never `git notes append`), target resolution via `listTurns()`/`parseSnapshotMessage()` never bare `HEAD`, `src/cache.js` migration needs (`usage TEXT` column via guarded `ALTER TABLE`, extended `upsertTurn()`, new narrow `updatePromptFields()` UPDATE), and the corrected finding that `cost.js` expects `usage` in Anthropic's exact shape (`input_tokens`/`output_tokens`/`cache_read_input_tokens`/`cache_creation_input_tokens`)
- `.planning/research/PITFALLS.md` — Pitfall 1 (blind `addNote()` overwrite / race with the hook — this is the concrete mechanism D-03's merge requirement defends against), Pitfall 2/3 (notes outside filter-repo/BFG rewrite scope, old note blobs survive overwrite until GC — motivates why Phase 4's redaction must have already run before this phase's writes, and why Phase 6's purge procedure matters)
- `.planning/research/SUMMARY.md` — executive summary, confirms `record-prompt` is "the only missing writer" since `log`/`show --with-prompts` and `cost` already read these fields

### Phase 4 (dependency)
- `.planning/phases/04-secret-redaction-scanner/04-CONTEXT.md` — D-01 (generic `[REDACTED]` marker), D-02 (full vendor set), D-03 (SHA/UUID whitelist) — all content passed to `record-prompt` must be redacted through this scanner before the note write
- `src/redact.js` — the shipped scanner, exports exactly `{ redact }`, signature `redact(text) -> { text, count }`
- `.planning/phases/04-secret-redaction-scanner/04-REVIEW.md` — WR-01 flags `redact()` has no defensive type check and throws on non-string input; `record-prompt` must guard against non-string fields (e.g. `prompt`) before calling `redact()`, or catch/handle the throw

### Existing code (verified this session)
- `src/git.js` — `addNote(ref, commitSha, message)` / `getNote(ref, commitSha)` (lines 178, 183) — the only note read/write primitives, must be called through a merge-aware wrapper, never with a partial payload
- `src/cache.js` — `turns` table already has `prompt TEXT`, `model TEXT`, `latency_ms INTEGER` columns and an `upsertTurn()` that writes them (lines 37-39, 65-106) — but has NO `usage` or `tool_summary` column yet; this phase must add them via migration
- `AGENTS.md` — "all output is plain text on stdout, no `--json` flag" convention — `record-prompt` reads JSON on stdin (per D-01) but should not print JSON to stdout; confirm success/failure with plain text

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/git.js`'s `addNote`/`getNote` — read/write primitives to build the merge helper on top of
- `src/blame-util.js`'s `parseSnapshotMessage()` and `listAllTurns()`/session.js's `listTurns()` — turn resolution, already used by `log.js`/`show.js` for the same "never bare HEAD" reason
- `src/redact.js`'s `redact(text)` — call this on every free-text field before merging into the note payload

### Established Patterns
- Zero-npm-dependency discipline — no new packages
- `'use strict'`, plain functions, single `module.exports`, `node:test` fixture style (see `src/blame-util.js`/`src/blame-util.test.js`, `src/redact.js`/`src/redact.test.js` for the two most recent examples)
- Cache-first + `--no-cache` ref-walk fallback pattern already used by `log.js`/`blame.js`/`bisect.js`/`heatmap.js` — `record-prompt` is a writer, not a reader, so this pattern applies to how `log`/`show`/`cost` will later surface the new fields, not to `record-prompt` itself

### Integration Points
- `src/commands/record-prompt.js` (new) — reads stdin JSON, resolves target turn, redacts free-text fields, merges into the note via a new/extended note-write helper in `src/git.js`, best-effort updates `src/cache.js`
- `bin/git-turn` — new command needs registration in the `COMMANDS` array + `--help` text (same pattern as `heatmap`'s addition in Phase 03.1)
- `src/cache.js` — needs `usage TEXT`, `tool_summary TEXT` (JSON-serialized) columns added via guarded `ALTER TABLE`, plus either an extended `upsertTurn()` or the narrower `updatePromptFields()` update helper the architecture research recommends

</code_context>

<specifics>
## Specific Ideas

No UI/visual requirements — this is a non-interactive CLI writer command, stdin in, plain-text confirmation out. The four decisions above (stdin JSON, latest-turn-only targeting, merge-not-overwrite, per-tool breakdown) are the concrete shape; everything else is implementation detail for research/planning.

</specifics>

<deferred>
## Deferred Ideas

- A Claude Code Stop-hook wrapper script that actually constructs the JSON payload and pipes it to `record-prompt` — explicitly out of scope for this phase (this phase builds the receiving end only). Already tracked as a "Future Requirement" in `.planning/REQUIREMENTS.md` ("Claude Code Stop-hook wrapper to auto-supply latency_ms/prompt content to record-prompt — natural v0.3.x follow-on").

### Reviewed Todos (not folded)
- `2026-09-07-rich-diff-renderer.md` — keyword-matched this phase (score 0.6) but is unrelated (diff rendering, not note writing); not folded.
- `2026-09-17-mindwalk-integration.md` — keyword-matched this phase (score 0.4) but is unrelated (external tool integration exploration); not folded.

</deferred>

---

*Phase: 5-record-prompt Note-Write Path*
*Context gathered: 2026-09-18*
