# git-turn

**Core value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.

**Tech stack:** Node.js, git CLI (no libgit2), optional SQLite for read cache

**Repo:** https://github.com/scottcowan/git-turn

## What it is

A git extension (`git turn <cmd>`) that automatically groups agent commits into turns and makes them queryable. Works with any AI coding agent that makes git commits (Claude Code, Cursor, Aider, opencode).

## Storage model

- **Refs** — `refs/git-turn/sessions/{id}/turn-{N}` point at dangling snapshot commits
- **Snapshots** — dangling `commit-tree` commits with two trees: index state + full worktree (including untracked)
- **Notes** — `refs/notes/git-turn` stores `{session_id, turn_n, snapshot_sha, ts}` per turn on the HEAD commit, plus `prompt`/`model`/`usage`/`latency_ms`/`tool_summary` once `git turn record-prompt` (Phase 5) is run — merged via `updateNote()`'s read-merge-write helper, never a blind overwrite
- **Session meta** — `refs/git-turn/sessions/{id}/meta` durable per-session metadata (fork lineage via `session new --from`), survives after the session is no longer active
- **Op log** — `.git/git-turn/ops/` content-addressed operation log (jj-style) for undo/redo
- **SQLite cache** — shipped (`src/cache.js`, `d591cff`) — read cache for fast `log`/`cost` reads, rebuilt via `gc --rebuild` or automatically if stale

## Key Decisions

- **Forensics-first** — primary use is audit ("which turn broke this?"), not undo
- **No server required** — everything in local git object store and refs
- **No shell interpolation** — all git calls via `execFile(git, args[])`, never string concat
- **Hook fires on every commit** — serialized via pending-promise to prevent concurrent writes
- **Read-only turns skipped** — no commit = no snapshot (Option 1)
- **Separate from warren** — works in any git repo; warren is optional for `git turn branch`
- **Secret redaction is vendored, not borrowed** — warren has no content/regex secret detector (only an encrypted credential store), so `src/redact.js` (Phase 4) is a hand-vendored regex + Shannon-entropy scanner modeled on gitleaks/trufflehog patterns, zero new npm dependencies

## Current State

**Shipped:** v0.2 (Read Cache + Blame/Bisect) as of 2026-09-17 — see `.planning/milestones/v0.2-ROADMAP.md` and `.planning/milestones/v0.2-MILESTONE-AUDIT.md` (audit: passed). Covers v0.1 (Working CLI) through Phase 03.1 (turn heatmap): SQLite read cache, real `blame`/`bisect` at turn granularity, calendar-grid heatmap, colorized diff output, session fork lineage (`session new --from`), and cross-repo `export`.

14 commands working end-to-end: `init`, `log`, `show`, `diff`, `blame`, `bisect`, `revert`, `redo`, `status`, `gc`, `cost`, `session` (new/list), `export`, `heatmap`. Full test suite (145 tests). Hook installs via absolute path for cross-repo compatibility, and respects `core.hooksPath` (Husky/lefthook) instead of assuming the default hooks dir.

**Not yet implemented:** `branch --from <N>` (Phase 8 of v1.0, blocked on the Warren API). MCP server (Phase 7, v0.4) — planned.

**Phase 4 complete (2026-09-17):** `src/redact.js` — a standalone, zero-dependency secret scanner (`redact(text) -> { text, count }`) covering 9 vendor-prefixed categories (AWS, GitHub, OpenAI, Anthropic, Slack, Google, Stripe, PEM, generic key=value) plus a Shannon-entropy fallback for unstructured tokens, with a SHA/UUID whitelist to avoid false-positive redaction of legitimate git identifiers. Validated against realistic fixtures (22 tests) with documented false-negative behavior.

**Phase 5 complete (2026-09-20):** `git turn record-prompt` — reads a JSON payload on stdin (`{prompt, model, usage, latency_ms, tool_summary}`, all optional), redacts `prompt` through Phase 4's scanner, resolves the latest turn via `listTurns()`/`parseSnapshotMessage()` (never bare `HEAD`), and merges into the note via a new `updateNote(ref, sha, patchFn)` read-compare-retry helper in `src/git.js` (never a blind overwrite of the hook's fields). `usage` is stored verbatim in Anthropic's four-key shape; `tool_summary` is a per-tool call-count breakdown. SQLite cache extended with `usage`/`tool_summary` columns and a narrow `updatePromptFields()` writer. 26 new tests; 3 code-review warnings found and fixed same-phase (type validation on `model`/`tool_summary`, stderr diagnostic on cache-write failure, `??` vs `||` for zero-valued fields).

**Phase 6 complete (2026-09-21), v0.3 milestone done:** Found and fixed a real, previously-masked defect — `show.js`/`log.js`/`cost.js` looked up `refs/notes/git-turn` by the snapshot commit sha instead of the real HEAD commit sha where notes are actually written, so none of them ever saw Phase 5's real data until this phase's fix. Added `show.js`'s missing `--with-prompts` gate (matching `log.js`). Shipped `git turn redact <N>` (scrubs only the `prompt` field via `updateNote()`, no confirmation, matching `revert`/`redo` style) and `git turn gc --purge-notes` (`purgeNotesHistory()`: collapses notes history to a parentless commit, then reflog-expire + `gc --prune=now` — empirically verified the naive reflog-expire+gc-only sequence does NOT remove an old note blob, since `refs/notes/*` is a linear commit chain outside `git filter-repo`/BFG's coverage). Code review also caught and fixed a real pre-existing bug in `cost.js`'s Bedrock cross-region pricing lookup (double-prefixed, unmatchable key). 51 new tests (217 total); all 9 v0.3 requirements complete.

**Known issues:** none currently tracked — see `.planning/todos/pending/` for open work (rich diff renderer, an optional enhancement; mindwalk integration exploration).

## v0.3 Prompt Capture — SHIPPED (2026-09-21)

All target features complete:
- `git turn record-prompt` — attaches prompt/response metadata to the current turn's note (Phase 5)
- Note payload carries `prompt`/`model`/`latency_ms`/`usage`/`tool_summary` fields (Phase 5)
- Secret redaction built into the write path from day one (Phase 4, wired in Phase 5)
- `log`/`show --with-prompts` and `cost` verified end-to-end against real captured data (Phase 6, after fixing the sha-resolution bug)
- `git turn redact <N>` and `git turn gc --purge-notes` remediation path (Phase 6)

MCP server (Claude Code addon) deferred to v0.4 — out of scope for v0.3.

## Prior art

- pi-rewind (arpagon) — dangling commit-tree, two-tree snapshot, pending-promise pattern
- copilot-timeline-session (mmcs-work) — untracked exclusion, hash-keyed sidecar
- Jujutsu — content-addressed op log, op restore via update-ref only

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-21 after Phase 6 completion — v0.3 milestone shipped*
