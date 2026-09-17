# git-turn

**Core value:** Know exactly which agent turn broke your code — diff, blame, bisect, and revert at turn granularity.

**Tech stack:** Node.js, git CLI (no libgit2), optional SQLite for read cache

**Repo:** https://github.com/scottcowan/git-turn

## What it is

A git extension (`git turn <cmd>`) that automatically groups agent commits into turns and makes them queryable. Works with any AI coding agent that makes git commits (Claude Code, Cursor, Aider, opencode).

## Storage model

- **Refs** — `refs/git-turn/sessions/{id}/turn-{N}` point at dangling snapshot commits
- **Snapshots** — dangling `commit-tree` commits with two trees: index state + full worktree (including untracked)
- **Notes** — `refs/notes/git-turn` stores `{session_id, turn_n, snapshot_sha, ts}` per turn on the HEAD commit. `prompt`/`model`/`latency_ms`/`usage` are read defensively where present but nothing shipped writes them yet (Phase 4, not built).
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

## Current State

**Shipped:** v0.2 (Read Cache + Blame/Bisect) as of 2026-09-17 — see `.planning/milestones/v0.2-ROADMAP.md` and `.planning/milestones/v0.2-MILESTONE-AUDIT.md` (audit: passed). Covers v0.1 (Working CLI) through Phase 03.1 (turn heatmap): SQLite read cache, real `blame`/`bisect` at turn granularity, calendar-grid heatmap, colorized diff output, session fork lineage (`session new --from`), and cross-repo `export`.

14 commands working end-to-end: `init`, `log`, `show`, `diff`, `blame`, `bisect`, `revert`, `redo`, `status`, `gc`, `cost`, `session` (new/list), `export`, `heatmap`. Full test suite (145 tests). Hook installs via absolute path for cross-repo compatibility, and respects `core.hooksPath` (Husky/lefthook) instead of assuming the default hooks dir.

**Not yet implemented:** `branch --from <N>` (Phase 6, blocked on the Warren API). Prompt capture (Phase 4) and MCP server (Phase 5) — planned for v0.3.

**Known issues:** none currently tracked — see `.planning/todos/pending/` for open work (secret redaction on notes, folded into Phase 4 as a locked requirement; and the rich diff renderer, an optional enhancement).

## Current Milestone: v0.3 Prompt Capture

**Goal:** Persist prompt/model/latency/usage metadata per turn, safely.

**Target features:**
- `git turn record-prompt` — attach prompt/response metadata to the current turn's note
- Note payload gains `prompt`/`model`/`latency_ms`/`usage` fields (currently read defensively, never written)
- Secret redaction built into the write path from day one — scan for likely secrets (API keys, high-entropy tokens) before any prompt/response content is written into `refs/notes/git-turn`; reuse warren's secret pattern list rather than inventing a new one
- `--with-prompts` flag on `log`/`show` to surface captured prompt content

MCP server (Claude Code addon) deferred to a later milestone — out of scope for v0.3.

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
*Last updated: 2026-09-17 after v0.2 milestone, v0.3 started*
